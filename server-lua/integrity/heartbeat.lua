local Actions = require 'server-lua.repositories.actions'
local Config = require 'configs.server.heartbeat'
local DryRun = require 'server-lua.enforcement.dry_run'
local Engine = require 'server-lua.detection.engine'
local Id = require 'server-lua.id'
local Shared = require 'configs.shared.main'
local Sessions = require 'server-lua.services.sessions'
local M = {}

---@class HeartbeatState
---@field sequence number
---@field nonce string?
---@field deadline number
---@field graceUntil number
---@field consecutiveFailures number
---@field awaiting boolean
---@field lastClientTimer number?
---@field lastSchedulerTickCount number?
---@field inventoryHash number?

---@type table<number, HeartbeatState>
local states = {}

---@param source number
local function ensureState(source)
    if states[source] then return end
    states[source] = {
        sequence = 0,
        deadline = 0,
        graceUntil = GetGameTimer() + Config.joinGraceMs,
        consecutiveFailures = 0,
        awaiting = false,
    }
end

---@param source number
---@param state HeartbeatState
local function temporaryBan(source, state)
    local session = Sessions.getActive(source)
    if not session then return end

    if DryRun.active() then
        DryRun.skipped('heartbeat_temporary_ban', { source = source, failures = state.consecutiveFailures })
        return
    end

    local banId = Id.create('SAC-BAN')
    local action = Actions.statement({
        actorType = 'system',
        actionType = 'integrity.heartbeat_temporarily_banned',
        targetType = 'player',
        targetId = session.playerId,
        reason = 'Two consecutive heartbeat challenge failures',
        metadata = { banId = banId, failures = state.consecutiveFailures, durationHours = Config.temporaryBanHours },
        origin = 'heartbeat',
    })
    local committed = MySQL.transaction.await({
        { query = action.query, values = action.values },
        {
            query = [[INSERT INTO sac_bans (id, player_id, action_id, reason, expires_at)
                VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR))]],
            values = { banId, session.playerId, action.id, 'Heartbeat integrity failure', Config.temporaryBanHours },
        },
    })
    if committed then DropPlayer(source, locale('kick.heartbeat', banId)) end
end

---@param source number
---@param state HeartbeatState
---@param reason string
local function recordFailure(source, state, reason)
    state.awaiting = false
    state.nonce = nil
    state.consecutiveFailures = state.consecutiveFailures + 1
    Engine.submit({
        rule = 'integrity.heartbeat_failure',
        source = source,
        measured = {
            reason = reason,
            consecutiveFailures = state.consecutiveFailures,
            sequence = state.sequence,
        },
    })
    Player(source).state:set('simpleacHeartbeatDegraded', true, true)

    if Config.banOnFailure and state.consecutiveFailures >= Config.maximumConsecutiveFailures then
        CreateThread(function() temporaryBan(source, state) end)
    end
end

local function issueChallenges()
    local now = GetGameTimer()
    for _, player in ipairs(GetPlayers()) do
        local playerSource = tonumber(player)
        if playerSource then
            ensureState(playerSource)
            local state = states[playerSource]
            if now >= state.graceUntil then
                if state.awaiting and now > state.deadline then
                    recordFailure(playerSource, state, 'deadline_exceeded')
                end
                if not state.awaiting and state.consecutiveFailures < Config.maximumConsecutiveFailures then
                    state.sequence = state.sequence + 1
                    state.nonce = Id.create('SAC-ACT')
                    state.deadline = now + Config.responseDeadlineMs
                    state.awaiting = true
                    if Shared.debug then print(('[SimpleAC] heartbeat challenge #%d -> %d'):format(state.sequence, playerSource)) end
                    TriggerClientEvent('simpleac:heartbeat:challenge', playerSource, {
                        sequence = state.sequence,
                        nonce = state.nonce,
                        resources = Config.requiredClientResources,
                    })
                end
            end
        end
    end
end

function M.start()
    RegisterNetEvent('simpleac:heartbeat:response', function(payload)
        local playerSource = source
        local state = states[playerSource]
        if Shared.debug then print(('[SimpleAC] heartbeat response from %d (awaiting=%s)'):format(playerSource, tostring(state and state.awaiting))) end
        if not state or not state.awaiting or type(payload) ~= 'table' then return end

        if payload.sequence ~= state.sequence or payload.nonce ~= state.nonce then
            recordFailure(playerSource, state, 'invalid_or_replayed_response')
            return
        end
        if type(payload.schedulerAgeMs) ~= 'number' or payload.schedulerAgeMs < 0
            or payload.schedulerAgeMs > Config.maximumSchedulerGapMs
            or type(payload.schedulerMaximumGapMs) ~= 'number'
            or payload.schedulerMaximumGapMs > Config.maximumSchedulerGapMs then
            recordFailure(playerSource, state, 'component_stalled')
            return
        end
        if type(payload.clientTimer) ~= 'number' or type(payload.schedulerTickCount) ~= 'number'
            or (state.lastClientTimer and payload.clientTimer <= state.lastClientTimer)
            or (state.lastSchedulerTickCount and payload.schedulerTickCount <= state.lastSchedulerTickCount) then
            recordFailure(playerSource, state, 'runtime_counter_invalid')
            return
        end
        if type(payload.components) ~= 'table' then recordFailure(playerSource, state, 'component_report_missing') return end
        for _, componentName in ipairs({ 'movement', 'player_state', 'combat', 'vehicle' }) do
            local component = payload.components[componentName]
            if type(component) ~= 'table' or type(component.runs) ~= 'number'
                or type(component.failures) ~= 'number' or component.failures > 0 then
                recordFailure(playerSource, state, 'component_unhealthy')
                return
            end
        end
        if type(payload.resources) ~= 'table' then recordFailure(playerSource, state, 'resource_report_missing') return end
        for index = 1, #Config.requiredClientResources do
            local resourceName = Config.requiredClientResources[index]
            if payload.resources[resourceName] ~= 'started' then
                recordFailure(playerSource, state, 'required_resource_inactive')
                return
            end
        end
        if type(payload.inventoryHash) ~= 'number' or type(payload.inventoryCount) ~= 'number'
            or payload.inventoryCount < 1 or payload.inventoryCount > 2048 then
            recordFailure(playerSource, state, 'inventory_report_invalid')
            return
        end
        if state.inventoryHash and state.inventoryHash ~= payload.inventoryHash then
            Engine.submit({
                rule = 'integrity.resource_inventory_drift',
                source = playerSource,
                measured = {
                    previousHash = state.inventoryHash,
                    currentHash = payload.inventoryHash,
                    resourceCount = payload.inventoryCount,
                },
            })
        end

        state.awaiting = false
        state.nonce = nil
        state.consecutiveFailures = 0
        state.lastClientTimer = payload.clientTimer
        state.lastSchedulerTickCount = payload.schedulerTickCount
        state.inventoryHash = payload.inventoryHash
        Player(playerSource).state:set('simpleacHeartbeatDegraded', false, true)
    end)

    AddEventHandler('playerJoining', function() ensureState(source) end)
    AddEventHandler('playerDropped', function() states[source] = nil end)

    CreateThread(function()
        while true do
            Wait(Config.challengeIntervalMs)
            issueChallenges()
        end
    end)
end

return M
