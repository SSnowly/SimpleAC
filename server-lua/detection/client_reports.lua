local Engine = require 'server-lua.detection.engine'
local Grace = require 'server-lua.detection.grace'
local Registry = require 'server-lua.detection.rules'
local Sessions = require 'server-lua.services.sessions'
local M = {}
local windows = {}

function M.start()
    RegisterNetEvent('simpleac:detection:clientReport', function(rule, measured)
        local playerSource, now = source, GetGameTimer()
        if type(rule) ~= 'string' or type(measured) ~= 'table' then return end
        local definition = Registry.get(rule)
        if not definition or not definition.clientSourced then return end

        local state = windows[playerSource] or { started = now, count = 0 }
        if now - state.started > 10000 then state = { started = now, count = 0 } end
        state.count = state.count + 1
        windows[playerSource] = state
        if state.count > 20 then return end
        Engine.submit({ rule = rule, source = playerSource, measured = measured })
    end)

    RegisterNetEvent('simpleac:lifecycle:hint', function(kind)
        local playerSource = source
        if type(kind) ~= 'string' or not Sessions.getActive(playerSource) then return end
        Grace.grantHint(playerSource, kind)
    end)

    AddEventHandler('playerDropped', function() windows[source] = nil end)
end

return M
