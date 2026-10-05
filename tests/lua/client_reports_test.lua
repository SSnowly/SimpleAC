local T = require 'tests.lua.framework'
local H = T.H

local function start()
    H.netHandlers = {}
    require('server-lua.detection.client_reports').start()
end

---Replaces Engine.submit with a counter for the duration of one test body.
---@param body fun(submitted: string[])
local function withSubmitSpy(body)
    local engine = require 'server-lua.detection.engine'
    local original = engine.submit
    local submitted = {}
    engine.submit = function(signal) submitted[#submitted + 1] = signal.rule end
    local ok, err = pcall(body, submitted)
    engine.submit = original
    if not ok then error(err, 0) end
end

T.test('accepts only client-sourced rules over the report event', function()
    H.addPlayer(1)
    start()
    withSubmitSpy(function(submitted)
        H.fireNet(1, 'simpleac:detection:clientReport', 'network.entity_rate', { count = 99, limit = 1 })
        H.fireNet(1, 'simpleac:detection:clientReport', 'integrity.heartbeat_failure',
            { reason = 'x', consecutiveFailures = 1 })
        T.eq(#submitted, 0, 'server-side rules cannot be spoofed by a client')

        H.fireNet(1, 'simpleac:detection:clientReport', 'movement.teleport', { clientTimer = 1, distance = 999.0 })
        T.eq(#submitted, 1, 'client rule accepted')
    end)
end)

T.test('drops payloads with the wrong shape', function()
    H.addPlayer(1)
    start()
    withSubmitSpy(function(submitted)
        H.fireNet(1, 'simpleac:detection:clientReport', 42, {})
        H.fireNet(1, 'simpleac:detection:clientReport', 'movement.teleport', 'oops')
        T.eq(#submitted, 0)
    end)
end)

T.test('rate-limits report spam per player', function()
    H.addPlayer(1)
    start()
    withSubmitSpy(function(submitted)
        for _ = 1, 100 do
            H.fireNet(1, 'simpleac:detection:clientReport', 'movement.teleport', { clientTimer = 1, distance = 999.0 })
        end
        T.eq(#submitted, 20, 'only 20 reports per 10 seconds are considered')
        H.advance(11000)
        H.fireNet(1, 'simpleac:detection:clientReport', 'movement.teleport', { clientTimer = 1, distance = 999.0 })
        T.eq(#submitted, 21, 'window resets')
    end)
end)

T.test('lifecycle hints open a grace window for active sessions only', function()
    H.addPlayer(1)
    start()
    local grace = require 'server-lua.detection.grace'
    H.fireNet(2, 'simpleac:lifecycle:hint', 'cutscene')
    T.eq(grace.covers(2, 'movement'), false, 'unknown source ignored')
    H.fireNet(1, 'simpleac:lifecycle:hint', 'cutscene')
    T.eq(grace.covers(1, 'movement'), true)
end)
