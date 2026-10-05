local Actions = require 'server-lua.repositories.actions'
local Id = require 'server-lua.id'
local M = {}

---@class PlayerIdentifier
---@field type string
---@field key string
---@field value string?

---@class PlayerIdentity
---@field playerId string
---@field sessionId string
---@field correlationId string
---@field created boolean

local allowedIdentifierTypes = {
    license = true,
    license2 = true,
    fivem = true,
    discord = true,
    steam = true,
    xbl = true,
    live = true,
}

---@param source number
---@return PlayerIdentifier[]
local function collectIdentifiers(source)
    local identifiers = {}
    local rawIdentifiers = GetPlayerIdentifiers(source)

    for index = 1, #rawIdentifiers do
        local value = rawIdentifiers[index]
        local separator = value:find(':', 1, true)
        local identifierType = separator and value:sub(1, separator - 1) or nil

        if identifierType and allowedIdentifierTypes[identifierType] and #value <= 255 then
            identifiers[#identifiers + 1] = {
                type = identifierType,
                key = value,
                value = value,
            }
        end
    end

    local endpoint = GetPlayerEndpoint(source)
    if type(endpoint) == 'string' and endpoint ~= '' and #endpoint <= 255 then
        local endpointHash = MySQL.scalar.await([[
            SELECT LOWER(SHA2(CONCAT(HEX(identifier_salt), ?), 256))
            FROM sac_server_installation
            LIMIT 1
        ]], { endpoint })

        if type(endpointHash) == 'string' then
            identifiers[#identifiers + 1] = {
                type = 'ip',
                key = endpointHash,
                value = nil,
            }
        end
    end

    return identifiers
end

---@param identifiers PlayerIdentifier[]
---@return string?
local function findPlayer(identifiers)
    for index = 1, #identifiers do
        local identifier = identifiers[index]
        if identifier.type ~= 'ip' then
            local playerId = MySQL.scalar.await([[
                SELECT player_id
                FROM sac_player_identifiers
                WHERE identifier_type = ? AND identifier_key = ?
                ORDER BY last_seen_at DESC
                LIMIT 1
            ]], { identifier.type, identifier.key })

            if type(playerId) == 'string' then return playerId end
        end
    end

    return nil
end

---@param installationId string
function M.ensureInstallation(installationId)
    MySQL.insert.await([[
        INSERT INTO sac_server_installation (installation_id, secret_hash, identifier_salt)
        SELECT ?, LOWER(SHA2(HEX(RANDOM_BYTES(32)), 256)), RANDOM_BYTES(32)
        WHERE NOT EXISTS (SELECT 1 FROM sac_server_installation)
    ]], { installationId })
end

---@param source number
---@return string?
function M.findExisting(source)
    if type(source) ~= 'number' or source <= 0 then return nil end
    return findPlayer(collectIdentifiers(source))
end

---@param source number
---@return PlayerIdentity?
function M.openSession(source)
    if type(source) ~= 'number' or source <= 0 or GetPlayerName(source) == nil then return nil end

    local identifiers = collectIdentifiers(source)
    if #identifiers == 0 then return nil end

    local existingPlayerId = findPlayer(identifiers)
    local playerId = existingPlayerId or Id.create('SAC-PLY')
    local sessionId = Id.create('SAC-SES')
    local action = Actions.statement({
        actorType = 'system',
        actionType = 'player.session.opened',
        targetType = 'player',
        targetId = playerId,
        reason = 'Player connected',
        metadata = { sessionId = sessionId, serverSource = source },
        origin = 'connection',
    })
    local displayName = GetPlayerName(source):sub(1, 128)
    local endpointHash = ''
    local queries = {
        {
            query = [[INSERT INTO sac_players (id, display_name)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), last_seen_at = CURRENT_TIMESTAMP(3)]],
            values = { playerId, displayName },
        },
    }

    for index = 1, #identifiers do
        local identifier = identifiers[index]
        if identifier.type == 'ip' then
            endpointHash = identifier.key
            queries[#queries + 1] = {
                query = [[INSERT INTO sac_player_identifiers (
                    player_id, identifier_type, identifier_key, identifier_value
                ) VALUES (?, ?, ?, NULL)
                ON DUPLICATE KEY UPDATE identifier_value = NULL, last_seen_at = CURRENT_TIMESTAMP(3)]],
                values = { playerId, identifier.type, identifier.key },
            }
        else
            queries[#queries + 1] = {
                query = [[INSERT INTO sac_player_identifiers (
                    player_id, identifier_type, identifier_key, identifier_value
                ) VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE identifier_value = VALUES(identifier_value), last_seen_at = CURRENT_TIMESTAMP(3)]],
                values = { playerId, identifier.type, identifier.key, identifier.value },
            }
        end
    end

    queries[#queries + 1] = {
        query = [[INSERT INTO sac_player_sessions (
            id, correlation_id, player_id, server_source, endpoint_hash
        ) VALUES (?, ?, ?, ?, ?)]],
        values = {
            sessionId,
            action.correlationId,
            playerId,
            source,
            endpointHash,
        },
    }
    queries[#queries + 1] = { query = action.query, values = action.values }

    local committed = MySQL.transaction.await(queries)
    if not committed then error(('failed to open session for source %d'):format(source)) end

    return {
        playerId = playerId,
        sessionId = sessionId,
        correlationId = action.correlationId,
        created = existingPlayerId == nil,
    }
end

return M
