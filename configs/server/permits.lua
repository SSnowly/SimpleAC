-- Vehicles and explosions are only legitimate when a resource announced them first. Resources announce through
-- `init.lua` (loaded as the first shared script of every resource), which wraps the spawning natives.
return {
    -- false: unpermitted spawns/explosions are only logged (use while rolling init.lua out); true: permanent ban.
    enforce = true,
    -- On start, add `shared_script '@SimpleAC/init.lua'` as the first line of every resource's fxmanifest.lua and ask for a
    -- server restart when any were changed.
    autoInstall = true,
    -- Resources autoInstall must leave untouched (`name = true`).
    installExclude = {},
    -- Temporary: log every announcement that is granted or rejected.
    debugLog = false,
    -- How long an announcement stays valid, per kind, for client-side calls.
    ttlMs = { vehicle = 10000, explosion = 5000 },
    -- Announcements made by server scripts are not tied to a player, so they stay valid for a shorter time.
    serverTtlMs = { vehicle = 3000, explosion = 3000 },
    -- Wait before judging, so an announcement still in flight is not missed.
    graceMs = { vehicle = 1500, explosion = 750 },
    -- Announcements one player can make (all resources together) per window. Beyond it they are ignored.
    maximumPerWindow = 40,
    windowMs = 10000,
    -- Optional: only these resources may announce. Empty means any started resource.
    allowedResources = {},
    -- Resources listed here (`name = true`) may create vehicles without announcing (checked via the entity's creating script).
    trustedCreators = {},
    -- Explosions the game raises itself when a vehicle is destroyed. Only accepted with a vehicle this close.
    naturalExplosionTypes = {
        [6] = true, [7] = true, [8] = true, [10] = true, [15] = true, [16] = true, [17] = true,
        [26] = true, [29] = true, [31] = true, [33] = true, [34] = true,
    },
    naturalExplosionRadius = 15.0,
}
