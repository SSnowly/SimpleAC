local T = require 'tests.lua.framework'
local H = T.H

local function engine() return require 'server-lua.detection.engine' end
local function exceptions() return package.loaded['server-lua.detection.exceptions'] end

local teleport = { clientTimer = 1, distance = 500.0 }

T.test('rejects unknown rules, unknown sources and bad measurements', function()
    H.addPlayer(1)
    T.eq(engine().evaluate({ rule = 'nope.nope', source = 1, measured = {} }).reason, 'unknown_rule')
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 99, measured = teleport }).reason, 'invalid_source')
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = { f = function() end } }).reason,
        'invalid_measurement')
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = { clientTimer = 1, distance = 1.0 } })
        .reason, 'not_detected')
end)

T.test('join grace suppresses client-sourced rules only', function()
    H.addPlayer(1)
    require('server-lua.detection.grace').grantJoin(1)
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport }).reason, 'grace')

    local network = engine().evaluate({
        rule = 'network.event_rate', source = 1,
        measured = { eventName = 'x', count = 100, limit = 10 },
    })
    T.eq(network.accepted, true, 'network rule is never graced')
end)

T.test('detects after the grace window closes and applies cooldown', function()
    H.addPlayer(1)
    require('server-lua.detection.grace').grantJoin(1)
    H.advance(60000)
    local first = engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport })
    T.eq(first.accepted, true, 'first detection')
    T.eq(first.cancel, false, 'client heuristics never cancel')
    T.eq(first.outcome, 'log', 'log mode in the balanced profile')
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport }).reason, 'cooldown')
    H.advance(6000)
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport }).accepted, true)
end)

T.test('a single noisy client heuristic never escalates to a ban', function()
    H.addPlayer(1)
    H.advance(60000)
    for _ = 1, 30 do
        local decision = engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport })
        if decision.accepted then
            T.truthy(decision.outcome ~= 'permanent_ban' and decision.outcome ~= 'temporary_ban',
                'unexpected outcome ' .. decision.outcome)
        end
        H.advance(6000)
    end
end)

T.test('persistent exceptions suppress a detection', function()
    H.addPlayer(1, 'SAC-PLY-EXCEPTED')
    H.advance(60000)
    exceptions().excepted['SAC-PLY-EXCEPTED|movement.teleport'] = { id = 'SAC-EXC-1' }
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport }).reason, 'excepted')
end)

T.test('safe zones exempt matching categories by server-side position', function()
    H.addPlayer(1)
    H.advance(60000)
    local context = require 'server-lua.detection.context'
    T.eq(context.registerSafeZone('hospital', { x = 0.0, y = 0.0, z = 0.0, radius = 50.0 }), true)

    H.coords[1] = { x = 10.0, y = 0.0, z = 0.0 }
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport }).reason, 'safe_zone')
    T.eq(engine().evaluate({ rule = 'vehicle.warp', source = 1, measured = { clientTimer = 1, excess = 999.0 } })
        .accepted, true, 'vehicle category is not exempt by default')

    H.coords[1] = { x = 500.0, y = 0.0, z = 0.0 }
    H.advance(6000)
    T.eq(engine().evaluate({ rule = 'movement.teleport', source = 1, measured = teleport }).accepted, true)
end)

T.test('rejects malformed safe zone definitions', function()
    local context = require 'server-lua.detection.context'
    T.eq(context.registerSafeZone('bad zone', { x = 0, y = 0, z = 0, radius = 5 }), false, 'id characters')
    T.eq(context.registerSafeZone('z', { x = 0, y = 0, z = 0, radius = -1 }), false, 'radius')
    T.eq(context.registerSafeZone('z', { x = 0, y = 0, z = 0, radius = 5, exempt = 'all' }), false, 'exempt type')
end)

T.test('debug mode downgrades every enforcement to a console log', function()
    local shared = require 'configs.shared.main'
    local measured = { clientTimer = 1, method = 'debugger', checks = 10 }

    H.addPlayer(1)
    local live = engine().evaluate({ rule = 'integrity.nui_devtools', source = 1, measured = measured })
    T.eq(live.outcome, 'temporary_ban', 'enforced outside debug mode')

    shared.debug = true
    H.addPlayer(2)
    local debug = engine().evaluate({ rule = 'integrity.nui_devtools', source = 2, measured = measured })
    shared.debug = false
    T.eq(debug.accepted, true, 'still detected')
    T.eq(debug.outcome, 'log', 'no enforcement')
    T.eq(debug.wouldHave, 'temporary_ban', 'records what it would have done')
    T.eq(debug.announce, true, 'printed to the console')
    T.eq(debug.cancel, false, 'no cancellation')
end)
