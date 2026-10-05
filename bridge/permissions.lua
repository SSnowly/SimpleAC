local M = {}

---@param source number
---@param permission string
---@return boolean
function M.hasAce(source, permission)
    if type(source) ~= 'number' or source < 0 then return false end
    if type(permission) ~= 'string' or permission == '' then return false end

    return IsPlayerAceAllowed(tostring(source), permission)
end

return M
