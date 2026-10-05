-- Minimal CitizenFX/ox_lib stand-ins so server modules can be exercised with a plain Lua 5.4 interpreter.
local H = { now = 0, players = {}, sessions = {}, handlers = {}, netHandlers = {}, coords = {}, health = {}, vehicles = {} }

function H.reset()
    H.now, H.players, H.sessions, H.coords, H.health, H.vehicles = 1000000, {}, {}, {}, {}, {}
    for _, name in ipairs({
        'server-lua.detection.grace', 'server-lua.detection.context', 'server-lua.detection.engine',
        'server-lua.detection.client_reports', 'server-lua.detection.allowances',
        'server-lua.protections.vehicle', 'server-lua.vehicles.baseline', 'server-lua.evidence.capture',
    }) do package.loaded[name] = nil end
end

---@param source number
---@param playerId string?
function H.addPlayer(source, playerId)
    H.players[source] = 'player' .. source
    H.sessions[source] = { playerId = playerId or ('SAC-PLY-' .. source), sessionId = 'SAC-SES-' .. source }
    H.health[source] = 200
    H.coords[source] = { x = 0.0, y = 0.0, z = 0.0 }
end

function H.advance(ms) H.now = H.now + ms end

---@param source number
---@param model number
---@param speed number metres per second along x
function H.putInVehicle(source, model, speed)
    H.vehicles[source] = { entity = source * 1000, model = model, velocity = { x = speed, y = 0.0, z = 0.0 } }
end

GetGameTimer = function() return H.now end
GetPlayerName = function(source) return H.players[source] end
GetPlayerPed = function(source) return H.players[source] and source * 100 or 0 end
GetEntityHealth = function(ped) return H.health[ped // 100] or 0 end
GetEntityCoords = function(ped)
    local c = H.coords[ped // 100]
    return { x = c.x, y = c.y, z = c.z }
end
GetCurrentResourceName = function() return 'simpleac' end
LoadResourceFile = function() return nil end
GetHashKey = function(text)
    local hash = 0
    for index = 1, #text do
        hash = (hash + text:lower():byte(index)) & 0xFFFFFFFF
        hash = (hash + (hash << 10)) & 0xFFFFFFFF
        hash = hash ~ (hash >> 6)
    end
    hash = (hash + (hash << 3)) & 0xFFFFFFFF
    hash = hash ~ (hash >> 11)
    return (hash + (hash << 15)) & 0xFFFFFFFF
end
local function vehicleByEntity(entity)
    for source, vehicle in pairs(H.vehicles) do
        if vehicle.entity == entity then return source, vehicle end
    end
end
GetVehiclePedIsIn = function(ped) local vehicle = H.vehicles[ped // 100] return vehicle and vehicle.entity or 0 end
GetPedInVehicleSeat = function(entity)
    local source, vehicle = vehicleByEntity(entity)
    if not vehicle then return 0 end
    return vehicle.driver == false and 0 or source * 100
end
GetEntityModel = function(entity) local _, vehicle = vehicleByEntity(entity) return vehicle and vehicle.model or 0 end
GetEntityVelocity = function(entity)
    local _, vehicle = vehicleByEntity(entity)
    return vehicle and vehicle.velocity or { x = 0.0, y = 0.0, z = 0.0 }
end
GetInvokingResource = function() return 'other_resource' end
GetConvarInt = function(_, default) return default end
AddEventHandler = function(name, handler) H.handlers[name] = handler end
RegisterNetEvent = function(name, handler) if handler then H.netHandlers[name] = handler end end
CreateThread = function(fn) pcall(fn) end
-- ox_lib's locale() reads locales/<lang>.json; tests only need it to exist.
locale = function(key) return key end
json = { encode = function() return '{}' end }
MySQL = setmetatable({}, { __index = function() return { await = function() return nil end } end })

package.loaded['server-lua.services.sessions'] = {
    getActive = function(source) return H.sessions[source] end,
    findSource = function() return nil end,
}
package.loaded['server-lua.detection.exceptions'] = {
    excepted = {},
    find = function(playerId, ruleKey)
        local list = package.loaded['server-lua.detection.exceptions'].excepted
        return list[playerId .. '|' .. ruleKey]
    end,
    reload = function() end,
}

---@param source number
---@param handler string
---@param ... any
function H.fireNet(source, handler, ...)
    local previous = _G.source
    _G.source = source
    local ok, err = pcall(H.netHandlers[handler], ...)
    _G.source = previous
    if not ok then error(err, 2) end
end

return H
