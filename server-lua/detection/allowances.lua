local Actions = require 'server-lua.repositories.actions'
local Id = require 'server-lua.id'
local Sessions = require 'server-lua.services.sessions'
local M = {}

---@class RuntimeAllowance
---@field id string
---@field source number
---@field playerId string
---@field behavior string
---@field resourceName string
---@field reason string
---@field expiresAt number

---@type table<string, RuntimeAllowance>
local allowances = {}

---@param source number
---@param behavior string
---@param resourceName string
---@param durationMs number
---@param reason string
---@return string?
function M.create(source, behavior, resourceName, durationMs, reason)
    local session = Sessions.getActive(source)
    if not session then return nil end
    if type(behavior) ~= 'string' or #behavior < 3 or #behavior > 128 then return nil end
    if type(resourceName) ~= 'string' or resourceName == '' or #resourceName > 128 then return nil end
    if type(durationMs) ~= 'number' or durationMs < 100 or durationMs > 300000 then return nil end
    if type(reason) ~= 'string' or #reason < 3 or #reason > 512 then return nil end

    local allowance = {
        id = Id.create('SAC-ALW'),
        source = source,
        playerId = session.playerId,
        behavior = behavior,
        resourceName = resourceName,
        reason = reason,
        expiresAt = GetGameTimer() + math.floor(durationMs),
    }
    local action = Actions.statement({
        actorType = 'resource',
        actorId = resourceName,
        actionType = 'allowance.created',
        targetType = 'player',
        targetId = session.playerId,
        reason = reason,
        metadata = { allowanceId = allowance.id, behavior = behavior, durationMs = durationMs },
        origin = 'export',
    })
    local committed = MySQL.transaction.await({
        {
            query = [[INSERT INTO sac_runtime_allowance_audit (
                id, player_id, behavior, resource_name, reason, expires_at
            ) VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND))]],
            values = { allowance.id, session.playerId, behavior, resourceName, reason, durationMs * 1000 },
        },
        { query = action.query, values = action.values },
    })
    if not committed then return nil end

    allowances[allowance.id] = allowance
    return allowance.id
end

---@param allowanceId string
---@param resourceName string
---@return boolean
function M.revoke(allowanceId, resourceName)
    local allowance = allowances[allowanceId]
    if not allowance or allowance.resourceName ~= resourceName then return false end

    local action = Actions.statement({
        actorType = 'resource',
        actorId = resourceName,
        actionType = 'allowance.revoked',
        targetType = 'player',
        targetId = allowance.playerId,
        reason = allowance.reason,
        metadata = { allowanceId = allowanceId, behavior = allowance.behavior },
        origin = 'export',
    })
    local committed = MySQL.transaction.await({
        {
            query = [[UPDATE sac_runtime_allowance_audit
                SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL]],
            values = { allowanceId },
        },
        { query = action.query, values = action.values },
    })
    if not committed then return false end

    allowances[allowanceId] = nil
    return true
end

---@param source number
---@param behavior string
---@param resourceName string?
---@return boolean
function M.isAllowed(source, behavior, resourceName)
    local now = GetGameTimer()

    for id, allowance in pairs(allowances) do
        if allowance.expiresAt <= now then
            allowances[id] = nil
        elseif allowance.source == source
            and allowance.behavior == behavior
            and (not resourceName or allowance.resourceName == resourceName) then
            return true
        end
    end

    return false
end

AddEventHandler('playerDropped', function()
    local playerSource = source
    for id, allowance in pairs(allowances) do
        if allowance.source == playerSource then allowances[id] = nil end
    end
end)

return M
