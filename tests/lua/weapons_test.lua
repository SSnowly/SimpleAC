local T = require 'tests.lua.framework'
local H = T.H

local PISTOL = GetHashKey('weapon_pistol') & 0xFFFFFFFF

local base = {
    weapons = {
        weapon_pistol = { Damage = 26.0, WeaponRange = 120.0, NetworkPlayerDamageModifier = 1.0, HeadShotDamageModifierPlayer = 2.0 },
        weapon_rpg = { Damage = 0.0 },
    },
}

local options = { rangeMultiplier = 2.0, headshotMultiplier = 5 }

T.test('limits are derived from meta fields', function()
    local baseline = require 'server-lua.weapons.baseline'
    baseline.use(base)
    local limits = baseline.limits(baseline.find(PISTOL).entry, options)
    T.eq(limits.maxDamage, 26.0)
    T.eq(limits.headshotMultiplier, 2.0)
    T.eq(limits.maxDistance, 240.0)
end)

T.test('weapons without damage have no damage limit and unknown headshot falls back to config', function()
    local baseline = require 'server-lua.weapons.baseline'
    baseline.use(base)
    local limits = baseline.limits(baseline.find(GetHashKey('weapon_rpg')).entry, options)
    T.eq(limits.maxDamage, nil)
    T.eq(limits.headshotMultiplier, 5)
    T.eq(limits.maxDistance, nil)
end)

T.test('scanned weapons override the baseline and custom overrides win over both', function()
    local baseline = require 'server-lua.weapons.baseline'
    baseline.use(base, { WEAPON_PISTOL = { Damage = 40.0, WeaponRange = 150.0, source = 'addon_guns' } },
        { weapons = { weapon_pistol = { Damage = 55.0 } } })
    local found = baseline.find(PISTOL)
    T.eq(found.entry.Damage, 55.0)
    T.eq(found.entry.WeaponRange, 150.0)
    T.eq(found.entry.source, 'custom')
    baseline.use(base, { WEAPON_PISTOL = { Damage = 40.0, source = 'addon_guns' } })
    T.eq(baseline.find(PISTOL).entry.source, 'addon_guns')
    T.eq(baseline.find(PISTOL).entry.Damage, 40.0)
    T.eq(baseline.find(PISTOL).entry.WeaponRange, 120.0)
end)

T.test('a rejected damage event cancels and restores the victim on the attacker client', function()
    H.addPlayer(1)
    H.addPlayer(2)
    H.netHandlers = {}
    H.handlers = {}
    local cancelled, restored = 0, {}
    CancelEvent = function() cancelled = cancelled + 1 end
    TriggerClientEvent = function(name, target, ...) restored[#restored + 1] = { name = name, target = target, args = { ... } } end
    NetworkGetEntityFromNetworkId = function(netId) return netId == 77 and 200 or 0 end
    DoesEntityExist = function() return true end
    GetEntityType = function() return 1 end
    GetResourceState = function() return 'missing' end
    GetPedArmour = function() return 25 end
    GetSelectedPedWeapon = function() return PISTOL end
    SetTimeout = function(_, fn) fn() end
    H.health[2] = 150

    package.loaded['server-lua.weapons.baseline'] = nil
    package.loaded['server-lua.protections.combat'] = nil
    local baseline = require 'server-lua.weapons.baseline'
    baseline.start = function() end
    baseline.use(base)
    local engine = require 'server-lua.detection.engine'
    local original = engine.submit
    engine.submit = function() return { cancel = true } end
    require('server-lua.protections.combat').start()

    H.handlers.weaponDamageEvent(1, {
        weaponType = PISTOL, weaponDamage = 500, overrideDefaultDamage = true, hitComponent = 0, hitGlobalId = 77,
    })
    engine.submit = original

    T.eq(cancelled, 1)
    T.truthy(#restored >= 1, 'attacker was told the real health')
    T.eq(restored[1].name, 'simpleac:combat:restore')
    T.eq(restored[1].target, 1)
    T.eq(restored[1].args[1], 77)
    T.eq(restored[1].args[2], 150)
    T.eq(restored[1].args[3], 25)
end)
