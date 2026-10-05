local Actions = require 'server-lua.repositories.actions'
local Config = require 'configs.server.captures'
local Id = require 'server-lua.id'
local Logger = require 'server-lua.logger'
local Sessions = require 'server-lua.services.sessions'
local M = {}

local ENCODINGS = { jpg = true, webp = true, png = true }

---@type table<number, number> source -> GetGameTimer() of the last accepted request
local lastRequest = {}
---@type table<number, number> source -> GetGameTimer() of the last automatic capture
local lastAutomatic = {}
---@type table<number, number> source -> GetGameTimer() of the last sweep capture
local lastSweep = {}
---@type table<string, { source: number, expiresAt: number }> requested captures still waiting for an upload
local pending = {}

local function tokenSeconds()
    return math.max(10, math.min(600, GetConvarInt('simpleac:capture_token_seconds', 60)))
end

local function pendingCount()
    local now, count = GetGameTimer(), 0
    for id, entry in pairs(pending) do
        if entry.expiresAt < now then pending[id] = nil else count = count + 1 end
    end
    return count
end

---@class CaptureOptions
---@field source number
---@field trigger 'manual' | 'detection' | 'burst' | 'delayed' | 'random' | 'sweep'
---@field reason string
---@field requestedBy string?
---@field detectionId string?
---@field caseId string?
---@field encoding string?
---@field delayMs number?
---@field burst { count: number, intervalMs: number }?

---Creates the capture row and upload token, then asks the client for a screenshot.
---@param options CaptureOptions
---@return string? captureId
---@return string? failure
local function send(options)
    local source = options.source
    local session = Sessions.getActive(source)
    if not session or GetPlayerName(source) == nil then return nil, 'player_offline' end
    if pendingCount() >= Config.maximumPending then return nil, 'busy' end

    local token = MySQL.scalar.await('SELECT LOWER(HEX(RANDOM_BYTES(32)))')
    if type(token) ~= 'string' or #token ~= 64 then return nil, 'unavailable' end

    local captureId = Id.create('SAC-CAP')
    local action = Actions.statement({
        actorType = options.requestedBy and 'web_api' or 'system',
        actorId = options.requestedBy,
        actionType = 'capture.requested',
        targetType = 'player',
        targetId = session.playerId,
        reason = options.reason:sub(1, 512),
        metadata = { captureId = captureId, trigger = options.trigger, detectionId = options.detectionId },
        origin = 'capture',
    })
    local committed = MySQL.transaction.await({
        {
            query = [[INSERT INTO sac_captures (
                    id, player_id, detection_id, case_id, status, trigger_type, requested_by, action_id,
                    token_hash, token_expires_at
                ) VALUES (?, ?, ?, ?, 'requested', ?, ?, ?, LOWER(SHA2(?, 256)),
                    DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND))]],
            values = {
                captureId, session.playerId, options.detectionId, options.caseId, options.trigger,
                options.requestedBy or 'system', action.id, token, tokenSeconds(),
            },
        },
        { query = action.query, values = action.values },
    })
    if not committed then return nil, 'unavailable' end

    pending[captureId] = { source = source, expiresAt = GetGameTimer() + tokenSeconds() * 1000 }
    -- A browser page served over HTTPS may not call a plain-HTTP game server, so direct upload is only offered when
    -- the operator exposes the resource over HTTPS; otherwise the client sends the image through a latent event.
    local base = GetConvar('simpleac:capture_upload_url', ''):gsub('/+$', '')
    TriggerClientEvent('simpleac:capture:request', source, {
        id = captureId,
        token = token,
        uploadUrl = base:sub(1, 8) == 'https://' and ('%s/v1/captures/upload/%s'):format(base, token) or nil,
        bytesPerSecond = Config.latentBytesPerSecond,
        encoding = ENCODINGS[options.encoding] and options.encoding or Config.encoding,
        quality = Config.quality,
        maxWidth = Config.maxWidth,
    })
    return captureId, nil
end

---Requests one screenshot, or a delayed and/or burst series. The first screenshot of a series is subject to the
---per-player cooldown; later shots of the same series are not.
---@param options CaptureOptions
---@return { ok: true, ids: string[] } | { ok: false, reason: string }
function M.request(options)
    if not Config.enabled then return { ok = false, reason = 'disabled' } end
    local source = options.source
    local now = GetGameTimer()
    if lastRequest[source] and now - lastRequest[source] < Config.perPlayerCooldownMs then
        return { ok = false, reason = 'cooldown' }
    end
    lastRequest[source] = now

    local shots, interval = 1, 0
    if options.burst then
        shots = math.max(1, math.min(Config.maximumBurst, math.floor(options.burst.count)))
        interval = math.max(500, math.floor(options.burst.intervalMs))
    end
    local delay = math.max(0, math.min(Config.maximumDelayMs, math.floor(options.delayMs or 0)))

    local ids = {}
    local trigger = shots > 1 and 'burst' or options.trigger
    if delay == 0 then
        local first = {}
        for key, value in pairs(options) do first[key] = value end
        first.trigger = trigger
        local id, failure = send(first)
        if not id then return { ok = false, reason = failure or 'unavailable' } end
        ids[1] = id
    end

    local remaining = shots - #ids
    if remaining > 0 then
        CreateThread(function()
            if delay > 0 then Wait(delay) end
            for index = 1, remaining do
                if delay == 0 or index > 1 then Wait(interval) end
                if GetPlayerName(source) == nil then return end
                send({
                    source = source, trigger = trigger, reason = options.reason,
                    requestedBy = options.requestedBy, detectionId = options.detectionId,
                    caseId = options.caseId, encoding = options.encoding,
                })
            end
        end)
    end

    -- Captures that start after a delay have no ID yet; the series is accepted and logged when they are created.
    return { ok = true, ids = ids }
end

---Called by the detection engine after a detection is stored.
---@param source number?
---@param decision table
function M.onDetection(source, decision)
    local automatic = Config.automatic
    if not automatic.enabled or not source or not decision.rule then return end
    if automatic.rules[decision.rule.key] ~= true then return end

    local now = GetGameTimer()
    if lastAutomatic[source] and now - lastAutomatic[source] < automatic.cooldownMs then return end
    lastAutomatic[source] = now

    M.request({
        source = source,
        trigger = 'detection',
        reason = ('Detection %s'):format(decision.rule.key),
        detectionId = decision.detectionId,
    })
end

function M.start()
    AddEventHandler('simpleac:internal:captureStored', function(captureId)
        if type(captureId) == 'string' then pending[captureId] = nil end
    end)

    AddEventHandler('simpleac:internal:captureFailed', function(captureId)
        if type(captureId) == 'string' then pending[captureId] = nil end
    end)

    ---Screenshot sent through the game client. Only the player the capture was requested from can deliver it, once.
    RegisterNetEvent('simpleac:capture:data', function(captureId, token, mediaType, data)
        local playerSource = source
        local entry = type(captureId) == 'string' and pending[captureId]
        if not entry or entry.source ~= playerSource then return end
        pending[captureId] = nil
        local limit = GetConvarInt('simpleac:capture_max_bytes', 4 * 1024 * 1024) * 4 // 3 + 8
        if type(token) ~= 'string' or #token ~= 64 or type(mediaType) ~= 'string' or #mediaType > 32
            or type(data) ~= 'string' or #data == 0 or #data > limit then return end
        TriggerEvent('simpleac:internal:captureUpload', captureId, token, mediaType, data)
    end)

    RegisterNetEvent('simpleac:capture:failed', function(captureId, reason)
        local playerSource = source
        local entry = type(captureId) == 'string' and pending[captureId]
        if not entry or entry.source ~= playerSource then return end
        pending[captureId] = nil
        MySQL.update.await([[UPDATE sac_captures SET status = 'failed', error = ?, token_hash = NULL
            WHERE id = ? AND status = 'requested']], { ('client_%s'):format(tostring(reason):sub(1, 64)), captureId })
    end)

    AddEventHandler('playerDropped', function()
        lastRequest[source] = nil
        lastAutomatic[source] = nil
        lastSweep[source] = nil
    end)

    ---Called by the TypeScript control plane after it authorised an API request. The request waits on the database,
    ---and an export that yields cannot return a value across runtimes, so the answer goes to `callback`.
    ---@param playerId string
    ---@param options table
    ---@param callback fun(result: table)
    exports('InternalRequestCapture', function(playerId, options, callback)
        -- A function passed in from another runtime arrives as a callable table, not a Lua function.
        if type(callback) ~= 'function' and not (type(callback) == 'table' and callback.__cfx_functionReference) then
            return
        end
        if GetInvokingResource() ~= GetCurrentResourceName() then return callback({ ok = false, reason = 'forbidden' }) end
        if type(playerId) ~= 'string' or type(options) ~= 'table' then return callback({ ok = false, reason = 'invalid' }) end

        CreateThread(function()
            local source = Sessions.findSource(playerId)
            if not source then return callback({ ok = false, reason = 'player_offline' }) end
            callback(M.request({
                source = source,
                trigger = type(options.burst) == 'table' and 'burst' or (tonumber(options.delayMs) or 0) > 0 and 'delayed'
                    or 'manual',
                reason = type(options.reason) == 'string' and options.reason or 'Manual capture',
                requestedBy = type(options.requestedBy) == 'string' and options.requestedBy or nil,
                encoding = type(options.encoding) == 'string' and options.encoding or nil,
                delayMs = tonumber(options.delayMs),
                burst = type(options.burst) == 'table' and {
                    count = tonumber(options.burst.count) or 2,
                    intervalMs = tonumber(options.burst.intervalMs) or 1500,
                } or nil,
            }))
        end)
    end)

    RegisterCommand('simpleac_capture', function(commandSource, args)
        if commandSource ~= 0 then return end
        local target = tonumber(args[1])
        if not target or GetPlayerName(target) == nil then
            print('usage: simpleac_capture <server id> [reason]')
            return
        end
        local reason = #args > 1 and table.concat(args, ' ', 2) or 'Manual capture from the console'
        local result = M.request({ source = target, trigger = 'manual', reason = reason, requestedBy = nil })
        Logger.structured(result.ok and 'info' or 'warn', 'capture_command', {
            target = target, ok = result.ok, reason = result.reason, ids = result.ids,
        })
    end, true)

    if Config.sweep.enabled then
        CreateThread(function()
            local sweep = Config.sweep
            while true do
                local players = GetPlayers()
                local gap = math.max(sweep.minimumGapMs, math.floor(sweep.intervalMs / math.max(1, #players)))
                Wait(gap)

                local now = GetGameTimer()
                local target, oldest
                for index = 1, #players do
                    local source = tonumber(players[index])
                    if source and Sessions.getActive(source) then
                        -- A player that was never swept counts as overdue since the start of their session.
                        local last = lastSweep[source] or -math.huge
                        if (not oldest or last < oldest) and now - last >= gap then
                            target, oldest = source, last
                        end
                    end
                end

                if target and pendingCount() < sweep.maximumPending then
                    local result = M.request({
                        source = target, trigger = 'sweep', reason = 'Scheduled sweep', encoding = sweep.encoding,
                    })
                    -- A cooldown means staff or a detection captured them moments ago; that counts as a sweep.
                    if result.ok or result.reason == 'cooldown' then lastSweep[target] = now end
                end
            end
        end)
    end

    if Config.random.enabled then
        CreateThread(function()
            while true do
                Wait(Config.random.intervalMs + math.random(0, Config.random.jitterMs))
                local players = GetPlayers()
                if #players > 0 then
                    local target = tonumber(players[math.random(1, #players)])
                    if target then
                        M.request({ source = target, trigger = 'random', reason = 'Random sample' })
                    end
                end
            end
        end)
    end
end

return M
