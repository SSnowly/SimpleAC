local definitions = {
    { 'WEAPON_UNARMED', 40, 3.5 }, { 'WEAPON_PISTOL', 80, 180.0 },
    { 'WEAPON_COMBATPISTOL', 80, 180.0 }, { 'WEAPON_APPISTOL', 75, 160.0 },
    { 'WEAPON_SMG', 70, 220.0 }, { 'WEAPON_ASSAULTRIFLE', 100, 350.0 },
    { 'WEAPON_CARBINERIFLE', 100, 350.0 }, { 'WEAPON_PUMPSHOTGUN', 240, 90.0 },
    { 'WEAPON_SNIPERRIFLE', 250, 1000.0 }, { 'WEAPON_HEAVYSNIPER', 300, 1400.0 },
    { 'WEAPON_RPG', 1000, 1200.0, true }, { 'WEAPON_MINIGUN', 100, 500.0, true },
    { 'WEAPON_RAILGUN', 1000, 1200.0, true },
}
local weapons = {}
for _, definition in ipairs(definitions) do
    weapons[GetHashKey(definition[1])] = {
        item = definition[1], maxDamage = definition[2], maxDistance = definition[3], blacklisted = definition[4],
    }
end

return {
    equipGraceMs = 1750,
    ownershipCacheMs = 750,
    distanceTolerance = 15.0,
    damageTolerance = 5,
    ammoTolerance = 2,
    shotCorrelationMs = 1750,
    maximumDamageEventsPerSecond = 24,
    weapons = weapons,
    invalidPlayerDamageWeapons = {
        [GetHashKey('WEAPON_FALL')] = true, [GetHashKey('WEAPON_DROWNING')] = true,
        [GetHashKey('WEAPON_DROWNING_IN_VEHICLE')] = true, [GetHashKey('WEAPON_EXHAUSTION')] = true,
    },
}
