-- Loaded as the first shared script of every resource: shared_script '@SimpleAC/init.lua'
-- It wraps the natives SimpleAC polices so that a resource's legitimate calls announce themselves.
-- Anything that spawns a vehicle or an explosion without an announcement is treated as a cheat.
local resource = GetCurrentResourceName()
if resource == 'SimpleAC' or rawget(_G, '__simpleac_init') then return end
rawset(_G, '__simpleac_init', true)

local isServer = IsDuplicityVersion()
local announce

if isServer then
    announce = function(kind)
        pcall(function() exports.SimpleAC:Permit(kind) end)
    end
else
    announce = function(kind)
        TriggerServerEvent('simpleac:permit', kind, resource)
    end
end

---@param name string native name as a global
---@param kind string
local function wrap(name, kind)
    local original = _G[name]
    if type(original) ~= 'function' then return end

    rawset(_G, name, function(...)
        announce(kind)
        return original(...)
    end)
end

if isServer then
    wrap('CreateVehicle', 'vehicle')
    wrap('CreateVehicleServerSetter', 'vehicle')
else
    wrap('CreateVehicle', 'vehicle')
    wrap('AddExplosion', 'explosion')
    wrap('AddOwnedExplosion', 'explosion')
end
