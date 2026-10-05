local T = require 'tests.lua.framework'
local H = T.H

local populationTypes = {}

local function setup()
    H.addPlayer(1)
    H.netHandlers = {}
    populationTypes = {}
    NetworkGetEntityOwner = function() return 1 end
    GetEntityType = function() return 1 end
    GetEntityModel = function() return 123 end
    GetEntityPopulationType = function(entity) return populationTypes[entity] or 7 end
    local cancelled = 0
    CancelEvent = function() cancelled = cancelled + 1 end
    local engine = require 'server-lua.detection.engine'
    local original = engine.submit
    local submitted = {}
    engine.submit = function(signal) submitted[#submitted + 1] = signal.rule return { cancel = true } end
    package.loaded['server-lua.protections.network'] = nil
    require('server-lua.protections.network').start()
    return submitted, function() return cancelled end, function() engine.submit = original end
end

T.test('ambient population entities are never counted or cancelled', function()
    local submitted, cancelled, restore = setup()
    for entity = 1, 500 do populationTypes[entity] = 5 end
    for entity = 1, 500 do H.handlers.entityCreating(entity) end
    restore()
    T.eq(#submitted, 0)
    T.eq(cancelled(), 0)
end)

T.test('script-created entities over the limit are still rate limited and cancelled', function()
    local submitted, cancelled, restore = setup()
    for entity = 1, 60 do H.handlers.entityCreating(entity) end
    restore()
    T.truthy(#submitted > 0, 'rate rule submitted')
    T.eq(submitted[1], 'network.entity_rate')
    T.truthy(cancelled() > 0, 'creation cancelled')
end)

T.test('abnormal projectiles are filtered, normal ones pass', function()
    local submitted, cancelled, restore = setup()
    H.coords[1] = { x = 0.0, y = 0.0, z = 0.0 }
    DoesEntityExist = function() return true end
    NetworkGetEntityFromNetworkId = function(netId) return netId end
    local config = require 'configs.server.protections'
    config.projectile.deniedWeapons[777] = true

    H.handlers.startProjectileEvent(1, { weaponHash = 1, initialPositionX = 5.0, initialPositionY = 0.0,
        initialPositionZ = 0.0, ownerNetId = 0 })
    T.eq(#submitted, 0, 'normal projectile passes')

    H.handlers.startProjectileEvent(1, { weaponHash = 777 })
    H.handlers.startProjectileEvent(1, { initialPositionX = 900.0, initialPositionY = 0.0, initialPositionZ = 0.0 })
    NetworkGetEntityOwner = function() return 2 end
    H.handlers.startProjectileEvent(1, { ownerNetId = 55 })
    config.projectile.deniedWeapons[777] = nil
    restore()
    T.eq(#submitted, 3, 'denied weapon, far spawn and foreign owner')
    T.eq(submitted[1], 'network.projectile_abnormal')
    T.eq(cancelled(), 3, 'all cancelled')
end)

T.test('abnormal particles are filtered, attached and normal ones pass', function()
    local submitted, cancelled, restore = setup()
    H.coords[1] = { x = 0.0, y = 0.0, z = 0.0 }

    H.handlers.ptFxEvent(1, { scale = 1.0, offsetX = 3.0, offsetY = 0.0, offsetZ = 0.0 })
    H.handlers.ptFxEvent(1, { scale = 1.0, entityNetId = 9, offsetX = 9000.0, offsetY = 0.0, offsetZ = 0.0 })
    T.eq(#submitted, 0, 'normal and entity-attached particles pass')

    H.handlers.ptFxEvent(1, { scale = 500.0 })
    H.handlers.ptFxEvent(1, { scale = 1.0, offsetX = 9000.0, offsetY = 0.0, offsetZ = 0.0 })
    restore()
    T.eq(#submitted, 2, 'oversized and far-away particles')
    T.eq(submitted[1], 'network.particle_abnormal')
    T.eq(cancelled(), 2, 'both cancelled')
end)
