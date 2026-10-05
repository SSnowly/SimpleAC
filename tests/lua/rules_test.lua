local T = require 'tests.lua.framework'
local Config = require 'configs.client.detections'
local Profile = require 'configs.server.profile'
local Registry = require 'server-lua.detection.rules'

T.test('every registered rule has a profile entry', function()
    for key in pairs(Registry.all()) do
        T.truthy(Profile.rules[key], 'profile missing rule ' .. key)
    end
end)

T.test('every profile entry refers to a registered rule', function()
    for key in pairs(Profile.rules) do
        T.truthy(Registry.get(key), 'profile has unknown rule ' .. key)
    end
end)

T.test('client thresholds are shared with the server validators', function()
    local teleport = Registry.get('movement.teleport')
    T.eq(teleport.validate({ clientTimer = 1, distance = Config.teleportDistance + 1 }), true, 'above threshold')
    T.eq(teleport.validate({ clientTimer = 1, distance = Config.teleportDistance - 1 }), false, 'below threshold')
    T.eq(teleport.validate({ distance = Config.teleportDistance + 1 }), false, 'missing clientTimer')
    T.eq(teleport.validate({ clientTimer = 1, distance = 'far' }), false, 'wrong type')

    local alpha = Registry.get('state.visibility')
    T.eq(alpha.validate({ clientTimer = 1, alpha = Config.minimumAlpha - 1 }), true, 'alpha below minimum')
    T.eq(alpha.validate({ clientTimer = 1, alpha = 255 }), false, 'visible')
end)

T.test('godmode needs invincibility or enough proofs', function()
    local rule = Registry.get('state.godmode')
    T.eq(rule.validate({ clientTimer = 1, invincible = true, proofs = 0 }), true, 'invincible')
    T.eq(rule.validate({ clientTimer = 1, invincible = false, proofs = Config.godmodeProofs }), true, 'proofs')
    T.eq(rule.validate({ clientTimer = 1, invincible = false, proofs = Config.godmodeProofs - 1 }), false, 'few proofs')
end)

T.test('infinite ammo requires an unchanged ammo count over a real burst', function()
    local rule = Registry.get('combat.infinite_ammo')
    local burst = Config.infiniteAmmoShots
    T.eq(rule.validate({ clientTimer = 1, shots = burst, ammoBefore = 50, ammoAfter = 50 }), true, 'unchanged')
    T.eq(rule.validate({ clientTimer = 1, shots = burst, ammoBefore = 50, ammoAfter = 42 }), false, 'consumed')
    T.eq(rule.validate({ clientTimer = 1, shots = burst - 1, ammoBefore = 50, ammoAfter = 50 }), false, 'short burst')
end)

T.test('nui devtools reports need a known probe method', function()
    local rule = Registry.get('integrity.nui_devtools')
    T.eq(rule.clientSourced, true, 'client sourced')
    local checks = Config.nuiDevtools.confirmChecks
    T.eq(rule.validate({ clientTimer = 1, method = 'stalled', checks = checks }), true, 'stalled page')
    T.eq(rule.validate({ clientTimer = 1, method = 'debugger', checks = checks }), true, 'debugger probe')
    T.eq(rule.validate({ clientTimer = 1, method = 'debugger', checks = checks - 1 }), false, 'too few checks')
    T.eq(rule.validate({ clientTimer = 1, method = 'other', checks = checks }), false, 'unknown method')
    T.eq(rule.validate({ method = 'debugger', checks = checks }), false, 'missing clientTimer')
end)

T.test('nui devtools progress reports stay below the ban threshold', function()
    local rule = Registry.get('integrity.nui_devtools_progress')
    local every, confirm = Config.nuiDevtools.progressEvery, Config.nuiDevtools.confirmChecks
    T.eq(rule.validate({ clientTimer = 1, method = 'debugger', checks = every }), true, 'first progress step')
    T.eq(rule.validate({ clientTimer = 1, method = 'debugger', checks = every - 1 }), false, 'too early')
    T.eq(rule.validate({ clientTimer = 1, method = 'stalled', checks = confirm }), false, 'belongs to the ban rule')
end)

T.test('profile entries may carry an announce override', function()
    T.eq(Registry.get('integrity.nui_devtools').announce, true, 'rule default')
    T.eq(Profile.rules['integrity.nui_devtools'].announce, nil, 'no override by default')
end)

T.test('only client rules are flagged clientSourced', function()
    T.eq(Registry.get('movement.noclip').clientSourced, true, 'client rule')
    T.eq(Registry.get('network.entity_rate').clientSourced, nil, 'server rule')
    T.eq(Registry.get('combat.damage_excessive').clientSourced, nil, 'authoritative combat rule')
end)

T.test('projectile and particle rules need an abnormal signal', function()
    local projectile = Registry.get('network.projectile_abnormal')
    T.eq(projectile.validate({ ownerMismatch = true }), true, 'owner mismatch')
    T.eq(projectile.validate({ ownerMismatch = false, distanceExceeded = false }), false, 'nothing abnormal')
    local particle = Registry.get('network.particle_abnormal')
    T.eq(particle.validate({ scaleExceeded = true }), true, 'oversized')
    T.eq(particle.validate({ scaleExceeded = false, distanceExceeded = false }), false, 'nothing abnormal')
end)
