local M = {}

---@class DetectionException
---@field id string
---@field scope_type string
---@field scope_value string
---@field effect string

---@type DetectionException[]
local active = {}

function M.reload()
    active = MySQL.query.await([[
        SELECT id, scope_type, scope_value, effect
        FROM sac_exceptions
        WHERE revoked_by_action_id IS NULL
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))
    ]])
end

-- The HTTP API writes exceptions straight to the database and then asks for the cache to be rebuilt.
AddEventHandler('simpleac:internal:reloadExceptions', function()
    CreateThread(function()
        local ok, err = pcall(M.reload)
        if not ok then print(('[SimpleAC] exception reload failed: %s'):format(tostring(err))) end
    end)
end)

---@param playerId string
---@param ruleKey string
---@param resourceName string?
---@return DetectionException?
function M.find(playerId, ruleKey, resourceName)
    for index = 1, #active do
        local exception = active[index]
        local matches = (exception.scope_type == 'player' and exception.scope_value == playerId)
            or (exception.scope_type == 'detection' and exception.scope_value == ruleKey)
            or (resourceName and exception.scope_type == 'resource' and exception.scope_value == resourceName)

        if matches and (exception.effect == 'allow' or exception.effect == 'ignore') then return exception end
    end

    return nil
end

return M
