local M = {}

---@param source number
---@return string?
function M.getPrimaryIdentifier(source)
    if type(source) ~= 'number' or source <= 0 or GetPlayerName(source) == nil then return nil end

    return GetPlayerIdentifierByType(source, 'license')
        or GetPlayerIdentifierByType(source, 'license2')
        or GetPlayerIdentifierByType(source, 'fivem')
end

return M
