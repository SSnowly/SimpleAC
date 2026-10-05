local M = {}
local catalogCache

---@return table<number, table>?
function M.catalog()
    if catalogCache then return catalogCache end
    if GetResourceState('ox_inventory') ~= 'started' then return nil end
    local ok, items = pcall(function() return exports.ox_inventory:Items() end)
    if not ok or type(items) ~= 'table' then return nil end
    catalogCache = {}
    for name, item in pairs(items) do
        if type(item) == 'table' and item.weapon == true and type(item.hash) == 'number' then
            catalogCache[item.hash] = { item = name, ammoItem = item.ammoname, throwable = item.throwable == true }
        end
    end
    return catalogCache
end

---@param source number
---@param itemName string
---@return boolean?
function M.hasWeapon(source, itemName)
    if itemName == 'WEAPON_UNARMED' then return true end
    if GetResourceState('ox_inventory') ~= 'started' then return nil end
    local ok, count = pcall(function()
        return exports.ox_inventory:GetItem(source, itemName, nil, true)
    end)
    if not ok then return nil end
    return type(count) == 'number' and count > 0
end

---@param source number
---@param itemName string
---@return table[]?
function M.weaponSlots(source, itemName)
    if GetResourceState('ox_inventory') ~= 'started' then return nil end
    local ok, slots = pcall(function()
        return exports.ox_inventory:GetSlotsWithItem(source, itemName, nil, false)
    end)
    return ok and slots or nil
end

---@return string
function M.provider()
    return GetResourceState('ox_inventory') == 'started' and 'ox_inventory' or 'none'
end

return M
