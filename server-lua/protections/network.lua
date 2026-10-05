local Config = require 'configs.server.protections'
local Engine = require 'server-lua.detection.engine'
local M = {}

---@class RateWindow
---@field startedAt number
---@field count number

---@type table<number, RateWindow>
local entityRates = {}
---@type RateWindow
local globalEntityRate = { startedAt = 0, count = 0 }
---@type table<number, RateWindow>
local explosionRates = {}
---@type table<string, table<number, RateWindow>>
local eventRates = {}

---@param windows table<number, RateWindow>
---@param source number
---@param windowMs number
---@return number
local function incrementRate(windows, source, windowMs)
    local now = GetGameTimer()
    local window = windows[source]
    if not window or now - window.startedAt >= windowMs then
        window = { startedAt = now, count = 0 }
        windows[source] = window
    end

    window.count = window.count + 1
    return window.count
end

---@param windowMs number
---@return number
local function incrementGlobalEntityRate(windowMs)
    local now = GetGameTimer()
    if now - globalEntityRate.startedAt >= windowMs then
        globalEntityRate = { startedAt = now, count = 0 }
    end

    globalEntityRate.count = globalEntityRate.count + 1
    return globalEntityRate.count
end

local function handleEntityCreating(entity)
    if type(entity) ~= 'number' or entity <= 0 then return end
    local owner = NetworkGetEntityOwner(entity)
    if type(owner) ~= 'number' or owner <= 0 or GetPlayerName(owner) == nil then return end

    if Config.entity.ignoredPopulationTypes[GetEntityPopulationType(entity)] then return end

    local model = GetEntityModel(entity)
    local playerCount = incrementRate(entityRates, owner, Config.entity.windowMs)
    local globalCount = incrementGlobalEntityRate(Config.entity.windowMs)
    local denied = Config.entity.deniedModels[model] == true
    local decision

    if denied then
        decision = Engine.submit({
            rule = 'network.entity_model',
            source = owner,
            measured = { model = model, denied = true, entityType = GetEntityType(entity) },
        })
    elseif playerCount > Config.entity.perPlayerLimit or globalCount > Config.entity.globalLimit then
        decision = Engine.submit({
            rule = 'network.entity_rate',
            source = owner,
            measured = {
                count = playerCount,
                limit = Config.entity.perPlayerLimit,
                globalCount = globalCount,
                globalLimit = Config.entity.globalLimit,
                model = model,
                entityType = GetEntityType(entity),
            },
        })
    end

    if decision and decision.cancel then CancelEvent() end
end

---@param sender number
---@param event table<string, any>
local function handleExplosion(sender, event)
    if type(sender) ~= 'number' or sender <= 0 or GetPlayerName(sender) == nil or type(event) ~= 'table' then return end

    local count = incrementRate(explosionRates, sender, Config.explosion.windowMs)
    local explosionType = tonumber(event.explosionType) or -1
    local damageScale = tonumber(event.damageScale) or 0
    local abnormal = Config.explosion.deniedTypes[explosionType] == true
        or event.isInvisible == true
        or damageScale > Config.explosion.maximumDamageScale
    local decision

    if abnormal then
        decision = Engine.submit({
            rule = 'network.explosion_abnormal',
            source = sender,
            measured = {
                explosionType = explosionType,
                deniedType = Config.explosion.deniedTypes[explosionType] == true,
                invisible = event.isInvisible == true,
                damageScale = damageScale,
                damageScaleExceeded = damageScale > Config.explosion.maximumDamageScale,
                audible = event.isAudible == true,
            },
        })
    elseif count > Config.explosion.perPlayerLimit then
        decision = Engine.submit({
            rule = 'network.explosion_rate',
            source = sender,
            measured = { count = count, limit = Config.explosion.perPlayerLimit, explosionType = explosionType },
        })
    end

    if decision and decision.cancel then CancelEvent() end
end

---@param sender number
---@param x number?
---@param y number?
---@param z number?
---@return number? metres between the sender's ped and the point
local function distanceFromSender(sender, x, y, z)
    if type(x) ~= 'number' or type(y) ~= 'number' or type(z) ~= 'number' then return nil end
    local ped = GetPlayerPed(sender)
    if type(ped) ~= 'number' or ped == 0 then return nil end
    local position = GetEntityCoords(ped)
    local dx, dy, dz = position.x - x, position.y - y, position.z - z
    return math.sqrt(dx * dx + dy * dy + dz * dz)
end

---@param sender number
---@param data table<string, any>
---@return boolean cancel
local function filterProjectile(sender, data)
    local projectile, weapon = tonumber(data.projectileHash), tonumber(data.weaponHash)
    local deniedProjectile = projectile ~= nil and Config.projectile.deniedProjectiles[projectile] == true
    local deniedWeapon = weapon ~= nil and Config.projectile.deniedWeapons[weapon] == true

    -- A projectile credited to an entity the sender does not own blames someone else for the shot.
    local ownerMismatch = false
    local ownerNetId = tonumber(data.ownerNetId)
    if ownerNetId and ownerNetId ~= 0 then
        local owner = NetworkGetEntityFromNetworkId(ownerNetId)
        ownerMismatch = type(owner) == 'number' and owner ~= 0 and DoesEntityExist(owner)
            and NetworkGetEntityOwner(owner) ~= sender
    end

    local distance = distanceFromSender(sender, tonumber(data.initialPositionX), tonumber(data.initialPositionY),
        tonumber(data.initialPositionZ))
    local distanceExceeded = distance ~= nil and distance > Config.projectile.maximumSpawnDistance

    if not (deniedProjectile or deniedWeapon or ownerMismatch or distanceExceeded) then return false end
    local decision = Engine.submit({
        rule = 'network.projectile_abnormal',
        source = sender,
        measured = {
            projectile = projectile,
            weapon = weapon,
            deniedProjectile = deniedProjectile,
            deniedWeapon = deniedWeapon,
            ownerMismatch = ownerMismatch,
            distance = distance,
            distanceExceeded = distanceExceeded,
        },
    })
    return decision.cancel == true
end

---@param sender number
---@param data table<string, any>
---@return boolean cancel
local function filterParticle(sender, data)
    local effect, asset = tonumber(data.effectHash), tonumber(data.assetHash)
    local deniedEffect = effect ~= nil and Config.particle.deniedEffects[effect] == true
    local deniedAsset = asset ~= nil and Config.particle.deniedAssets[asset] == true
    local scale = tonumber(data.scale)
    local scaleExceeded = scale ~= nil and scale > Config.particle.maximumScale

    local distance
    local attached = (tonumber(data.entityNetId) or 0) ~= 0 or data.isOnEntity == true
    if not attached then
        distance = distanceFromSender(sender, tonumber(data.offsetX), tonumber(data.offsetY), tonumber(data.offsetZ))
    end
    local distanceExceeded = distance ~= nil and distance > Config.particle.maximumDistance

    if not (deniedEffect or deniedAsset or scaleExceeded or distanceExceeded) then return false end
    local decision = Engine.submit({
        rule = 'network.particle_abnormal',
        source = sender,
        measured = {
            effect = effect,
            asset = asset,
            deniedEffect = deniedEffect,
            deniedAsset = deniedAsset,
            scale = scale,
            scaleExceeded = scaleExceeded,
            distance = distance,
            distanceExceeded = distanceExceeded,
        },
    })
    return decision.cancel == true
end

---@type table<string, fun(sender: number, data: table<string, any>): boolean>
local eventFilters = {
    startProjectileEvent = filterProjectile,
    ptFxEvent = filterParticle,
}

---@param eventName string
---@param limit number
---@param windowMs number
local function registerRateProtection(eventName, limit, windowMs)
    eventRates[eventName] = {}
    local filter = eventFilters[eventName]
    AddEventHandler(eventName, function(sender, data)
        if type(sender) ~= 'number' or sender <= 0 or GetPlayerName(sender) == nil then return end
        local count = incrementRate(eventRates[eventName], sender, windowMs)
        local cancel = false

        if count > limit then
            local decision = Engine.submit({
                rule = 'network.event_rate',
                source = sender,
                measured = { eventName = eventName, count = count, limit = limit, windowMs = windowMs },
            })
            cancel = decision.cancel == true
        end
        if filter and type(data) == 'table' and filter(sender, data) then cancel = true end
        if cancel then CancelEvent() end
    end)
end

function M.start()
    AddEventHandler('entityCreating', handleEntityCreating)
    AddEventHandler('explosionEvent', handleExplosion)
    for eventName, definition in pairs(Config.eventRates) do
        registerRateProtection(eventName, definition.limit, definition.windowMs)
    end
    AddEventHandler('playerDropped', function()
        entityRates[source] = nil
        explosionRates[source] = nil
        for _, windows in pairs(eventRates) do windows[source] = nil end
    end)
end

return M
