-- Damage and range come from the weapon baseline (shared/data/weapon-baselines*.json plus weapons.meta files found in
-- other resources). Entries here name the inventory item, the blacklist and, optionally, a hard
-- `maxDamage` / `maxDistance` that overrides the derived limit.
local definitions = {
    { 'WEAPON_UNARMED' }, { 'WEAPON_PISTOL' }, { 'WEAPON_COMBATPISTOL' }, { 'WEAPON_APPISTOL' }, { 'WEAPON_SMG' },
    { 'WEAPON_ASSAULTRIFLE' }, { 'WEAPON_CARBINERIFLE' }, { 'WEAPON_PUMPSHOTGUN' }, { 'WEAPON_SNIPERRIFLE' },
    { 'WEAPON_HEAVYSNIPER' }, { 'WEAPON_RPG', true }, { 'WEAPON_MINIGUN', true }, { 'WEAPON_RAILGUN', true },
}
local weapons = {}
for _, definition in ipairs(definitions) do
    weapons[GetHashKey(definition[1])] = {
        item = definition[1], blacklisted = definition[2],
    }
end

return {
    equipGraceMs = 1750,
    ownershipCacheMs = 750,
    distanceTolerance = 15.0,
    damageTolerance = 5,
    -- Used for weapons whose meta does not define a headshot modifier.
    headshotMultiplier = 5,
    headshotComponents = { [20] = true, [21] = true },
    -- A hit is allowed up to this multiple of the weapon's meta Range (bullets keep travelling past it).
    rangeMultiplier = 2.0,
    -- Wait before telling the attacker's client the victim's real health a second time.
    restoreDelayMs = 250,
    ammoTolerance = 2,
    shotCorrelationMs = 1750,
    maximumDamageEventsPerSecond = 24,
    weapons = weapons,
    invalidPlayerDamageWeapons = {
        [GetHashKey('WEAPON_FALL')] = true, [GetHashKey('WEAPON_DROWNING')] = true,
        [GetHashKey('WEAPON_DROWNING_IN_VEHICLE')] = true, [GetHashKey('WEAPON_EXHAUSTION')] = true,
    },
}
