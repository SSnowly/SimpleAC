local M = {}

---@type table<number, table<string, any>>
local playerContexts = {}
---@type table<string, table<string, any>>
local safeZones = {}

---@param source number
---@param key string
---@param value string | number | boolean
---@return boolean
function M.setPlayer(source, key, value)
    if type(source) ~= 'number' or source <= 0 or GetPlayerName(source) == nil then return false end
    if type(key) ~= 'string' or not key:match('^[a-z][a-zA-Z0-9_.]+$') or #key > 64 then return false end
    local valueType = type(value)
    if valueType ~= 'string' and valueType ~= 'number' and valueType ~= 'boolean' then return false end
    if valueType == 'string' and #value > 256 then return false end

    playerContexts[source] = playerContexts[source] or {}
    playerContexts[source][key] = value
    return true
end

---@param source number
---@return table<string, any>
function M.getPlayer(source)
    return playerContexts[source] or {}
end

---@param id string
---@param definition table<string, any>
---@return boolean
function M.registerSafeZone(id, definition)
    if type(id) ~= 'string' or not id:match('^[a-zA-Z0-9_.-]+$') or #id > 64 then return false end
    if type(definition) ~= 'table' or type(definition.x) ~= 'number'
        or type(definition.y) ~= 'number' or type(definition.z) ~= 'number'
        or type(definition.radius) ~= 'number' or definition.radius <= 0 or definition.radius > 10000 then
        return false
    end

    local exempt = { state = true, movement = true }
    if definition.exempt ~= nil then
        if type(definition.exempt) ~= 'table' then return false end
        exempt = {}
        for index = 1, #definition.exempt do
            local category = definition.exempt[index]
            if type(category) ~= 'string' or #category > 32 then return false end
            exempt[category] = true
        end
    end

    safeZones[id] = {
        x = definition.x,
        y = definition.y,
        z = definition.z,
        radius = definition.radius,
        exempt = exempt,
    }
    return true
end

---@return table<string, table<string, any>>
function M.safeZones()
    return safeZones
end

---True when the player's server-side position is inside a safe zone exempting the category.
---@param source number
---@param category string
---@return boolean
function M.inSafeZone(source, category)
    if next(safeZones) == nil then return false end

    local ped = GetPlayerPed(source)
    if not ped or ped == 0 then return false end
    local position = GetEntityCoords(ped)

    for _, zone in pairs(safeZones) do
        if zone.exempt[category] then
            local dx, dy, dz = position.x - zone.x, position.y - zone.y, position.z - zone.z
            if dx * dx + dy * dy + dz * dz <= zone.radius * zone.radius then return true end
        end
    end
    return false
end

AddEventHandler('playerDropped', function() playerContexts[source] = nil end)

return M
