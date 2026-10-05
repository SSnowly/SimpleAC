local Registry = require 'server-lua.detection.registry'

Registry.register({
    key = 'integrity.heartbeat_failure',
    category = 'integrity',
    version = 1,
    defaultSeverity = 100,
    defaultConfidence = 1.0,
    cooldownMs = 0,
    strikeWindowMs = 120000,
    strikeDecayMs = 60000,
    cancellable = false,
    validate = function(measured)
        return type(measured.reason) == 'string'
            and type(measured.consecutiveFailures) == 'number'
            and measured.consecutiveFailures > 0
    end,
})

Registry.register({
    key = 'integrity.resource_inventory_drift',
    category = 'integrity',
    version = 1,
    defaultSeverity = 45,
    defaultConfidence = 0.70,
    cooldownMs = 60000,
    strikeWindowMs = 300000,
    strikeDecayMs = 120000,
    cancellable = false,
    validate = function(measured)
        return type(measured.previousHash) == 'number'
            and type(measured.currentHash) == 'number'
            and measured.previousHash ~= measured.currentHash
    end,
})

Registry.register({
    key = 'network.entity_rate',
    category = 'network',
    version = 1,
    defaultSeverity = 85,
    defaultConfidence = 0.90,
    cooldownMs = 2000,
    strikeWindowMs = 30000,
    strikeDecayMs = 10000,
    cancellable = true,
    validate = function(measured)
        local playerExceeded = type(measured.count) == 'number'
            and type(measured.limit) == 'number'
            and measured.count > measured.limit
        local globalExceeded = type(measured.globalCount) == 'number'
            and type(measured.globalLimit) == 'number'
            and measured.globalCount > measured.globalLimit
        return playerExceeded or globalExceeded
    end,
})

Registry.register({
    key = 'network.entity_model',
    category = 'network',
    version = 1,
    defaultSeverity = 95,
    defaultConfidence = 1.0,
    cooldownMs = 1000,
    strikeWindowMs = 60000,
    strikeDecayMs = 20000,
    cancellable = true,
    validate = function(measured)
        return type(measured.model) == 'number' and measured.denied == true
    end,
})

Registry.register({
    key = 'network.explosion_rate',
    category = 'network',
    version = 1,
    defaultSeverity = 90,
    defaultConfidence = 0.95,
    cooldownMs = 1500,
    strikeWindowMs = 30000,
    strikeDecayMs = 10000,
    cancellable = true,
    validate = function(measured)
        return type(measured.count) == 'number'
            and type(measured.limit) == 'number'
            and measured.count > measured.limit
    end,
})

Registry.register({
    key = 'network.explosion_abnormal',
    category = 'network',
    version = 1,
    defaultSeverity = 90,
    defaultConfidence = 0.95,
    cooldownMs = 1000,
    strikeWindowMs = 60000,
    strikeDecayMs = 15000,
    cancellable = true,
    validate = function(measured)
        return measured.deniedType == true
            or measured.invisible == true
            or measured.damageScaleExceeded == true
    end,
})

Registry.register({
    key = 'network.projectile_abnormal',
    category = 'network',
    version = 1,
    defaultSeverity = 85,
    defaultConfidence = 0.90,
    cooldownMs = 1000,
    strikeWindowMs = 60000,
    strikeDecayMs = 15000,
    cancellable = true,
    validate = function(measured)
        return measured.deniedProjectile == true
            or measured.deniedWeapon == true
            or measured.ownerMismatch == true
            or measured.distanceExceeded == true
    end,
})

Registry.register({
    key = 'network.particle_abnormal',
    category = 'network',
    version = 1,
    defaultSeverity = 70,
    defaultConfidence = 0.85,
    cooldownMs = 1000,
    strikeWindowMs = 60000,
    strikeDecayMs = 15000,
    cancellable = true,
    validate = function(measured)
        return measured.deniedEffect == true
            or measured.deniedAsset == true
            or measured.scaleExceeded == true
            or measured.distanceExceeded == true
    end,
})

Registry.register({
    key = 'network.event_rate',
    category = 'network',
    version = 1,
    defaultSeverity = 80,
    defaultConfidence = 0.90,
    cooldownMs = 1500,
    strikeWindowMs = 30000,
    strikeDecayMs = 10000,
    cancellable = true,
    validate = function(measured)
        return type(measured.eventName) == 'string'
            and type(measured.count) == 'number'
            and type(measured.limit) == 'number'
            and measured.count > measured.limit
    end,
})

Registry.register({
    key = 'evidence.ocr_match',
    category = 'evidence',
    version = 1,
    defaultSeverity = 55,
    defaultConfidence = 0.60,
    cooldownMs = 30000,
    strikeWindowMs = 600000,
    strikeDecayMs = 300000,
    cancellable = false,
    announce = true,
    validate = function(measured)
        return type(measured.captureId) == 'string'
            and type(measured.terms) == 'string'
            and (measured.severity == 'low' or measured.severity == 'medium' or measured.severity == 'high')
    end,
})

Registry.register({
    key = 'identity.ban_evasion',
    category = 'identity',
    version = 1,
    defaultSeverity = 70,
    defaultConfidence = 0.75,
    cooldownMs = 60000,
    strikeWindowMs = 600000,
    strikeDecayMs = 300000,
    cancellable = false,
    announce = true,
    validate = function(measured)
        return type(measured.score) == 'number'
            and type(measured.targetPlayerId) == 'string'
            and type(measured.banId) == 'string'
            and type(measured.signals) == 'string'
            and (measured.outcome == 'review' or measured.outcome == 'restrict' or measured.outcome == 'block')
    end,
})

Registry.register({
    key = 'integration.protected_event',
    category = 'integration',
    version = 1,
    defaultSeverity = 80,
    defaultConfidence = 0.95,
    cooldownMs = 1000,
    strikeWindowMs = 30000,
    strikeDecayMs = 10000,
    cancellable = true,
    validate = function(measured)
        return type(measured.reason) == 'string' and measured.reason ~= ''
    end,
})

local ClientConfig = require 'configs.client.detections'

-- { category, severity, confidence, measured field, threshold, below }. Thresholds come from the
-- same table the client uses, so the sensor and the server-side validator cannot drift apart.
local clientRules = {
    ['movement.teleport'] = { 'movement', 65, 0.65, 'distance', ClientConfig.teleportDistance },
    ['movement.noclip'] = { 'movement', 55, 0.55, 'distance', ClientConfig.noclipDistance },
    ['movement.speed'] = { 'movement', 45, 0.55, 'speed', ClientConfig.footSpeed },
    ['movement.super_jump'] = { 'movement', 55, 0.60, 'height', ClientConfig.superJumpHeight },
    ['movement.freecam'] = { 'movement', 35, 0.45, 'distance', ClientConfig.freecamDistance },
    ['state.health'] = { 'state', 40, 0.50, 'delta', math.min(ClientConfig.healthIncrease, ClientConfig.armourIncrease) },
    ['state.visibility'] = { 'state', 45, 0.55, 'alpha', ClientConfig.minimumAlpha, true },
    ['state.vision'] = { 'state', 30, 0.45, nil, nil },
    ['state.model'] = { 'state', 20, 0.35, nil, nil },
    ['state.godmode'] = { 'state', 60, 0.60, 'proofs', ClientConfig.godmodeProofs - 1 },
    ['state.ragdoll_disabled'] = { 'state', 25, 0.35, nil, nil },
    ['combat.fire_rate'] = { 'combat', 60, 0.65, 'shots', ClientConfig.maximumShotsPerSecond },
    ['combat.infinite_ammo'] = { 'combat', 55, 0.60, 'shots', ClientConfig.infiniteAmmoShots - 1 },
    ['vehicle.speed'] = { 'vehicle', 45, 0.50, 'speed', ClientConfig.vehicleSpeed },
    ['vehicle.invulnerability'] = { 'vehicle', 55, 0.60, nil, nil },
    ['vehicle.repair'] = { 'vehicle', 40, 0.50, 'delta', ClientConfig.vehicleRepairIncrease },
    ['vehicle.warp'] = { 'vehicle', 50, 0.55, 'excess', ClientConfig.vehicleWarpExcess },
}

for key, definition in pairs(clientRules) do
    local field, threshold, below = definition[4], definition[5], definition[6]
    Registry.register({
        key = key,
        category = definition[1],
        version = 1,
        defaultSeverity = definition[2],
        defaultConfidence = definition[3],
        cooldownMs = 5000,
        strikeWindowMs = 60000,
        strikeDecayMs = 30000,
        cancellable = false,
        clientSourced = true,
        validate = function(measured)
            if type(measured.clientTimer) ~= 'number' then return false end
            if key == 'state.godmode' then
                return measured.invincible == true
                    or (type(measured.proofs) == 'number' and measured.proofs > threshold)
            end
            if key == 'combat.infinite_ammo' then
                return type(measured.shots) == 'number' and measured.shots > threshold
                    and type(measured.ammoBefore) == 'number' and type(measured.ammoAfter) == 'number'
                    and measured.ammoAfter >= measured.ammoBefore
            end
            if not field then return true end
            if type(measured[field]) ~= 'number' then return false end
            return below and measured[field] < threshold or (not below and measured[field] > threshold)
        end,
    })
end

Registry.register({
    key = 'integrity.nui_devtools',
    category = 'integrity',
    version = 1,
    defaultSeverity = 60,
    defaultConfidence = 0.75,
    cooldownMs = 30000,
    strikeWindowMs = 300000,
    strikeDecayMs = 120000,
    cancellable = false,
    clientSourced = true,
    announce = true,
    validate = function(measured)
        return type(measured.clientTimer) == 'number'
            and (measured.method == 'debugger' or measured.method == 'stalled')
            and type(measured.checks) == 'number'
            and measured.checks >= ClientConfig.nuiDevtools.confirmChecks
    end,
})

Registry.register({
    key = 'integrity.nui_devtools_progress',
    category = 'integrity',
    version = 1,
    defaultSeverity = 20,
    defaultConfidence = 0.50,
    cooldownMs = 1000,
    strikeWindowMs = 300000,
    strikeDecayMs = 120000,
    cancellable = false,
    clientSourced = true,
    announce = true,
    validate = function(measured)
        return type(measured.clientTimer) == 'number'
            and (measured.method == 'debugger' or measured.method == 'stalled')
            and type(measured.checks) == 'number'
            and measured.checks >= ClientConfig.nuiDevtools.progressEvery
            and measured.checks < ClientConfig.nuiDevtools.confirmChecks
    end,
})

local authoritativeCombatRules = {
    ['combat.weapon_blacklisted'] = { 95, 0.95 },
    ['combat.weapon_not_owned'] = { 70, 0.85 },
    ['combat.damage_excessive'] = { 90, 0.95 },
    ['combat.damage_distance'] = { 85, 0.90 },
    ['combat.damage_type_invalid'] = { 95, 0.95 },
    ['combat.ammo_invalid'] = { 65, 0.80 },
    ['combat.weapon_component_invalid'] = { 65, 0.80 },
    ['combat.damage_without_shot'] = { 45, 0.55 },
    ['combat.hit_rate'] = { 60, 0.70 },
    ['combat.weapon_mismatch'] = { 45, 0.55 },
}

for key, values in pairs(authoritativeCombatRules) do
    Registry.register({
        key = key,
        category = 'combat',
        version = 1,
        defaultSeverity = values[1],
        defaultConfidence = values[2],
        cooldownMs = 1500,
        strikeWindowMs = 60000,
        strikeDecayMs = 20000,
        cancellable = key ~= 'combat.weapon_not_owned' and key ~= 'combat.ammo_invalid'
            and key ~= 'combat.weapon_component_invalid' and key ~= 'combat.damage_without_shot'
            and key ~= 'combat.hit_rate' and key ~= 'combat.weapon_mismatch',
        validate = function(measured)
            if type(measured.weapon) ~= 'number' then return false end
            if key == 'combat.damage_excessive' then
                return type(measured.damage) == 'number' and type(measured.maximum) == 'number'
                    and measured.damage > measured.maximum
            end
            if key == 'combat.damage_distance' then
                return type(measured.distance) == 'number' and type(measured.maximum) == 'number'
                    and measured.distance > measured.maximum
            end
            if key == 'combat.ammo_invalid' then
                return type(measured.ammo) == 'number' and type(measured.maximum) == 'number'
                    and measured.ammo > measured.maximum
            end
            if key == 'combat.weapon_component_invalid' then
                return type(measured.component) == 'string' and measured.component ~= ''
            end
            if key == 'combat.hit_rate' then
                return type(measured.count) == 'number' and type(measured.maximum) == 'number'
                    and measured.count > measured.maximum
            end
            if key == 'combat.damage_without_shot' then return type(measured.ageMs) == 'number' end
            return true
        end,
    })
end

local baselineVehicleRules = {
    ['vehicle.handling_modified'] = { 60, 0.75 },
    ['vehicle.boost'] = { 50, 0.60 },
}

for key, values in pairs(baselineVehicleRules) do
    Registry.register({
        key = key,
        category = 'vehicle',
        version = 1,
        defaultSeverity = values[1],
        defaultConfidence = values[2],
        cooldownMs = 30000,
        strikeWindowMs = 300000,
        strikeDecayMs = 120000,
        cancellable = false,
        validate = function(measured)
            if type(measured.model) ~= 'string' then return false end
            if key == 'vehicle.boost' then
                return type(measured.speed) == 'number' and type(measured.ceiling) == 'number'
                    and measured.speed > measured.ceiling
            end
            return type(measured.deviations) == 'number' and measured.deviations > 0
                and type(measured.worst) == 'string'
        end,
    })
end

return Registry
