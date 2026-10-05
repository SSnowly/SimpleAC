local T = require 'tests.lua.framework'
local H = T.H

T.test('hints respect their cooldown and duration', function()
    H.addPlayer(1)
    local grace = require 'server-lua.detection.grace'
    T.eq(grace.grantHint(1, 'cutscene'), true)
    T.eq(grace.covers(1, 'movement'), true)
    T.eq(grace.covers(1, 'combat'), false, 'combat is not covered by a cutscene')
    H.advance(7000)
    T.eq(grace.covers(1, 'movement'), false, 'window expired')
    T.eq(grace.grantHint(1, 'cutscene'), false, 'still on cooldown')
    H.advance(30000)
    T.eq(grace.grantHint(1, 'cutscene'), true, 'cooldown elapsed')
end)

T.test('unknown or non-string hints are refused', function()
    H.addPlayer(1)
    local grace = require 'server-lua.detection.grace'
    T.eq(grace.grantHint(1, 'godmode'), false)
    T.eq(grace.grantHint(1, 42), false)
    T.eq(grace.grantHint(1, nil), false)
end)

T.test('respawn hints require a living ped on the server', function()
    H.addPlayer(1)
    local grace = require 'server-lua.detection.grace'
    H.health[1] = 0
    T.eq(grace.grantHint(1, 'respawn'), false, 'dead players cannot claim a respawn')
    H.health[1] = 200
    T.eq(grace.grantHint(1, 'respawn'), true)
end)

T.test('windows are per player and cleared on drop', function()
    H.addPlayer(1)
    H.addPlayer(2)
    local grace = require 'server-lua.detection.grace'
    grace.grantJoin(1)
    T.eq(grace.covers(1, 'movement'), true)
    T.eq(grace.covers(2, 'movement'), false)
    grace.clear(1)
    T.eq(grace.covers(1, 'movement'), false)
end)
