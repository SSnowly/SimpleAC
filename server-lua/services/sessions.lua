local Actions = require 'server-lua.repositories.actions'
local Identity = require 'server-lua.repositories.identity'
local Grace = require 'server-lua.detection.grace'
local DryRun = require 'server-lua.enforcement.dry_run'
local Id = require 'server-lua.id'
local Logger = require 'server-lua.logger'
local M = {}

---@class ActiveSession
---@field playerId string
---@field sessionId string

---@type table<number, ActiveSession>
local activeSessions = {}

---@param source number
local function openSession(source)
    if activeSessions[source] then return end

    local identity = Identity.openSession(source)
    if not identity then
        Logger.structured('warn', 'player_identity_unavailable', { source = source })
        return
    end

    activeSessions[source] = {
        playerId = identity.playerId,
        sessionId = identity.sessionId,
    }
    Grace.grantJoin(source)
    Logger.structured('info', 'player_session_opened', {
        source = source,
        playerId = identity.playerId,
        sessionId = identity.sessionId,
        created = identity.created,
    })
end

---@param source number
---@param reason string
local function closeSession(source, reason)
    local session = activeSessions[source]
    if not session then return end

    local action = Actions.statement({
        actorType = 'system',
        actionType = 'player.session.closed',
        targetType = 'player',
        targetId = session.playerId,
        reason = 'Player disconnected',
        metadata = { sessionId = session.sessionId, disconnectReason = reason:sub(1, 512) },
        origin = 'connection',
    })
    local committed = MySQL.transaction.await({
        {
            query = [[UPDATE sac_player_sessions
                SET disconnected_at = CURRENT_TIMESTAMP(3), disconnect_reason = ?
                WHERE id = ? AND disconnected_at IS NULL]],
            values = { reason:sub(1, 512), session.sessionId },
        },
        { query = action.query, values = action.values },
    })

    if not committed then error(('failed to close session %s'):format(session.sessionId)) end
    activeSessions[source] = nil
    Logger.structured('info', 'player_session_closed', {
        source = source,
        playerId = session.playerId,
        sessionId = session.sessionId,
    })
end

local function closeInterruptedSessions()
    local sessions = MySQL.query.await([[
        SELECT id, player_id
        FROM sac_player_sessions
        WHERE disconnected_at IS NULL
    ]])

    for index = 1, #sessions do
        local session = sessions[index]
        local action = Actions.statement({
            correlationId = Id.create('SAC-ACT'),
            actorType = 'system',
            actionType = 'player.session.interrupted',
            targetType = 'player',
            targetId = session.player_id,
            reason = 'SimpleAC resource restarted',
            metadata = { sessionId = session.id },
            origin = 'resource_start',
        })
        MySQL.transaction.await({
            {
                query = [[UPDATE sac_player_sessions
                    SET disconnected_at = CURRENT_TIMESTAMP(3), disconnect_reason = ?
                    WHERE id = ? AND disconnected_at IS NULL]],
                values = { 'simpleac_resource_restart', session.id },
            },
            { query = action.query, values = action.values },
        })
    end
end

function M.start()
    Identity.ensureInstallation(Id.create('SAC-KEY'))
    closeInterruptedSessions()

    AddEventHandler('playerConnecting', function(_, _, deferrals)
        local playerSource = source
        deferrals.defer()
        Wait(0)

        local ok, blockReason = xpcall(function()
            local playerId = Identity.findExisting(playerSource)
            if not playerId then return nil end

            local ban = MySQL.single.await([[
                SELECT id, reason
                FROM sac_bans
                WHERE player_id = ?
                  AND revoked_by_action_id IS NULL
                  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
                ORDER BY created_at DESC
                LIMIT 1
            ]], { playerId })
            if not ban then return nil end
            if DryRun.active() then
                DryRun.skipped('connection_block', { source = playerSource, banId = ban.id, reason = ban.reason })
                return nil
            end

            Actions.create({
                actorType = 'system',
                actionType = 'connection.blocked',
                targetType = 'player',
                targetId = playerId,
                reason = ban.reason,
                metadata = { banId = ban.id },
                origin = 'connection',
            })
            return locale('connection.blocked', ban.id)
        end, debug.traceback)

        if not ok then
            Logger.structured('error', 'connection_ban_check_failed', { source = playerSource, error = blockReason })
            deferrals.done()
            return
        end

        -- An explicit nil argument is not the same as no argument to the deferral bridge.
        if blockReason then deferrals.done(blockReason) else deferrals.done() end
    end)

    AddEventHandler('playerJoining', function()
        local playerSource = source
        CreateThread(function() openSession(playerSource) end)
    end)

    AddEventHandler('playerDropped', function(reason)
        local playerSource = source
        local safeReason = type(reason) == 'string' and reason or 'unknown'
        CreateThread(function() closeSession(playerSource, safeReason) end)
    end)

    local players = GetPlayers()
    for index = 1, #players do
        local playerSource = tonumber(players[index])
        if playerSource then CreateThread(function() openSession(playerSource) end) end
    end
end

---@param source number
---@return ActiveSession?
function M.getActive(source)
    return activeSessions[source]
end

---@return table<number, ActiveSession>
function M.all()
    local copy = {}
    for source, session in pairs(activeSessions) do copy[source] = session end
    return copy
end

---@param playerId string
---@return number?
function M.findSource(playerId)
    for source, session in pairs(activeSessions) do
        if session.playerId == playerId then return source end
    end

    return nil
end

return M
