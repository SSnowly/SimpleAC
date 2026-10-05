return {
    entity = {
        windowMs = 10000,
        perPlayerLimit = 40,
        globalLimit = 180,
        deniedModels = {},
        -- ePopulationType values the game spawns on its own (random permanent/parked/patrol/scenario/
        -- ambient, and cache). They are never rate limited or cancelled; only script-created
        -- entities (mission, tool, unknown) count towards the limits.
        ignoredPopulationTypes = { [1] = true, [2] = true, [3] = true, [4] = true, [5] = true, [9] = true },
    },
    explosion = {
        windowMs = 5000,
        perPlayerLimit = 8,
        maximumDamageScale = 1.0,
        deniedTypes = {},
    },
    projectile = {
        -- Keyed by hash, e.g. [GetHashKey('WEAPON_RAILGUN')] = true. Empty by default.
        deniedProjectiles = {},
        deniedWeapons = {},
        -- Metres between the sender's ped and where the projectile starts.
        maximumSpawnDistance = 250.0,
    },
    particle = {
        deniedEffects = {},
        deniedAssets = {},
        maximumScale = 25.0,
        -- Only checked for effects that are not attached to an entity.
        maximumDistance = 500.0,
    },
    eventRates = {
        ptFxEvent = { limit = 24, windowMs = 5000 },
        startProjectileEvent = { limit = 8, windowMs = 5000 },
        requestControlEvent = { limit = 80, windowMs = 5000 },
        startSyncedSceneEvent = { limit = 10, windowMs = 5000 },
        fireEvent = { limit = 20, windowMs = 5000 },
        clearPedTasksEvent = { limit = 15, windowMs = 5000 },
        giveWeaponEvent = { limit = 12, windowMs = 5000 },
        removeWeaponEvent = { limit = 12, windowMs = 5000 },
        removeAllWeaponsEvent = { limit = 4, windowMs = 5000 },
    },
    protectedEvents = {
        defaultWindowMs = 5000,
        defaultLimit = 10,
        maximumArguments = 16,
        maximumStringLength = 2048,
    },
}
