local Sessions = require 'server-lua.services.sessions'
local M = {}

---@param value any
---@return string
local function clean(value)
    return tostring(value):gsub('[%c]', ' '):sub(1, 200)
end

function M.start()
    local function internal()
        return GetInvokingResource() == GetCurrentResourceName()
    end

    ---Everyone with an open SimpleAC session, with what the game knows about them right now.
    exports('InternalPanelOnline', function()
        if not internal() then return {} end
        local list = {}
        for source, session in pairs(Sessions.all()) do
            if GetPlayerName(source) ~= nil then
                local ped = GetPlayerPed(source)
                local coords = ped ~= 0 and GetEntityCoords(ped) or vector3(0.0, 0.0, 0.0)
                list[#list + 1] = {
                    source = source,
                    playerId = session.playerId,
                    name = GetPlayerName(source),
                    ping = GetPlayerPing(source),
                    health = ped ~= 0 and GetEntityHealth(ped) or 0,
                    armor = ped ~= 0 and GetPedArmour(ped) or 0,
                    coords = { x = coords.x, y = coords.y, z = coords.z },
                    inVehicle = ped ~= 0 and GetVehiclePedIsIn(ped, false) ~= 0,
                    bucket = GetPlayerRoutingBucket(source),
                }
            end
        end
        return list
    end)

    exports('InternalPanelSource', function(playerId)
        if not internal() or type(playerId) ~= 'string' then return nil end
        return Sessions.findSource(playerId)
    end)

    exports('InternalPanelPlayer', function(source)
        if not internal() or type(source) ~= 'number' then return nil end
        local session = Sessions.getActive(source)
        return session and session.playerId or nil
    end)

    ---Shows a staff warning to the player. Returns false when they are no longer connected.
    exports('InternalPanelWarn', function(playerId, reason)
        if not internal() or type(playerId) ~= 'string' then return false end
        local source = Sessions.findSource(playerId)
        if not source then return false end
        TriggerClientEvent('simpleac:panel:warned', source, clean(reason))
        return true
    end)

    exports('InternalPanelKick', function(playerId, reason)
        if not internal() or type(playerId) ~= 'string' then return false end
        local source = Sessions.findSource(playerId)
        if not source then return false end
        DropPlayer(source, locale('kick.staff', clean(reason)))
        return true
    end)
end

return M
