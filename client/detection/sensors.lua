local Config = require 'configs.client.detections'
local Scheduler = require 'client.scheduler'

local previous = { position = nil, health = nil, armour = nil, model = nil, vehicleHealth = nil,
    vehicle = nil, vehiclePosition = nil, vehicleSpeed = 0, vehicleTime = 0, interior = nil, dead = false, cutscene = false, loading = false }
local shots, shotWindow, selectedWeapon = 0, GetGameTimer(), GetHashKey('WEAPON_UNARMED')
local ammoAtBurstStart = nil
local GUN_DAMAGE_TYPE = 3

---@param kind string
local function hint(kind) TriggerServerEvent('simpleac:lifecycle:hint', kind) end

---@param ped number
---@param weaponHash number
---@return string[]
local function weaponComponents(ped, weaponHash)
    if GetResourceState('ox_inventory') ~= 'started' then return {} end
    local ok, items = pcall(function() return exports.ox_inventory:Items() end)
    if not ok or type(items) ~= 'table' then return {} end
    local equipped = {}
    for name, item in pairs(items) do
        local components = type(item) == 'table' and item.component and item.client and item.client.component
        if type(components) == 'table' then
            for index = 1, #components do
                if HasPedGotWeaponComponent(ped, weaponHash, components[index]) then
                    equipped[#equipped + 1] = name
                    break
                end
            end
        end
        if #equipped >= 32 then break end
    end
    return equipped
end

local function report(rule, measured)
    measured.clientTimer = GetGameTimer()
    TriggerServerEvent('simpleac:detection:clientReport', rule, measured)
end

local function validPed()
    local ped = PlayerPedId()
    return ped ~= 0 and DoesEntityExist(ped) and not IsEntityDead(ped), ped
end

Scheduler.every('movement', 1250, 200, function()
    local ok, ped = validPed()
    if not ok then previous.position = nil return 'idle' end
    local position = GetEntityCoords(ped)
    if previous.position and not IsPedInAnyVehicle(ped, false) and not IsPedFalling(ped)
        and not IsPedRagdoll(ped) and not IsPedInParachuteFreeFall(ped) then
        local distance = #(position - previous.position)
        if distance > Config.teleportDistance then report('movement.teleport', { distance = distance }) end
        local speed = GetEntitySpeed(ped)
        if speed > Config.footSpeed then report('movement.speed', { speed = speed }) end
        if distance > Config.noclipDistance and IsEntityInAir(ped) and not HasCollisionLoadedAroundEntity(ped) then
            report('movement.noclip', { distance = distance, speed = speed })
        end
    end
    local cameraDistance = #(GetFinalRenderedCamCoord() - position)
    if cameraDistance > Config.freecamDistance and not IsCinematicCamRendering() then
        report('movement.freecam', { distance = cameraDistance })
    end
    if IsPedJumping(ped) and GetEntityHeightAboveGround(ped) > Config.superJumpHeight then
        report('movement.super_jump', { height = GetEntityHeightAboveGround(ped) })
    end
    previous.position = position
end, { maxBackoff = 2 })

Scheduler.every('player_state', 2000, 250, function()
    local ok, ped = validPed()
    if not ok then return end
    local health, armour, model = GetEntityHealth(ped), GetPedArmour(ped), GetEntityModel(ped)
    if previous.health and health - previous.health > Config.healthIncrease then
        report('state.health', { delta = health - previous.health, kind = 'health' })
    end
    if previous.armour and armour - previous.armour > Config.armourIncrease then
        report('state.health', { delta = armour - previous.armour, kind = 'armour' })
    end
    local alpha = GetEntityAlpha(ped)
    if alpha < Config.minimumAlpha or not IsEntityVisible(ped) then
        report('state.visibility', { alpha = alpha, visible = IsEntityVisible(ped) })
    end
    if GetUsingnightvision() or GetUsingseethrough() then
        report('state.vision', { night = GetUsingnightvision(), thermal = GetUsingseethrough() })
    end
    local proofs = 0
    local _, bullet, fire, explosion, collision, melee, steam = GetEntityProofs(ped)
    -- The native reports each proof as 0/1 (both truthy in Lua), so compare explicitly.
    for _, proof in ipairs({ bullet, fire, explosion, collision, melee, steam }) do
        if proof == true or (type(proof) == 'number' and proof ~= 0) then proofs = proofs + 1 end
    end
    local invincible = GetPlayerInvincible(PlayerId())
    if invincible or proofs >= Config.godmodeProofs then
        report('state.godmode', { invincible = invincible, proofs = proofs })
    end
    if Config.checkRagdoll and not CanPedRagdoll(ped) then report('state.ragdoll_disabled', { canRagdoll = false }) end
    if previous.model and previous.model ~= model then report('state.model', { previous = previous.model, current = model }) end
    previous.health, previous.armour, previous.model = health, armour, model
end)

Scheduler.every('combat', 100, 20, function()
    local ok, ped = validPed()
    if not ok then return end
    local currentWeapon = GetSelectedPedWeapon(ped)
    if currentWeapon ~= selectedWeapon then
        selectedWeapon = currentWeapon
        TriggerServerEvent('simpleac:combat:equipped', currentWeapon, GetAmmoInPedWeapon(ped, currentWeapon),
            weaponComponents(ped, currentWeapon))
    end
    if IsPedShooting(ped) then
        if shots == 0 then ammoAtBurstStart = GetAmmoInPedWeapon(ped, currentWeapon) end
        shots = shots + 1
        TriggerServerEvent('simpleac:combat:shot', currentWeapon)
    end
    local now = GetGameTimer()
    if now - shotWindow >= 1000 then
        if shots > Config.maximumShotsPerSecond then
            report('combat.fire_rate', { shots = shots, windowMs = now - shotWindow, weapon = GetSelectedPedWeapon(ped) })
        end
        if shots >= Config.infiniteAmmoShots and ammoAtBurstStart and GetWeaponDamageType(currentWeapon) == GUN_DAMAGE_TYPE then
            local ammoAfter = GetAmmoInPedWeapon(ped, currentWeapon)
            if ammoAfter >= ammoAtBurstStart then
                report('combat.infinite_ammo', { shots = shots, ammoBefore = ammoAtBurstStart, ammoAfter = ammoAfter,
                    weapon = currentWeapon })
            end
        end
        ammoAtBurstStart = nil
        shots, shotWindow = 0, now
    end
end)

Scheduler.every('vehicle', 1000, 150, function()
    local ok, ped = validPed()
    if not ok or not IsPedInAnyVehicle(ped, false) then
        previous.vehicleHealth, previous.vehicle, previous.vehiclePosition = nil, nil, nil
        return 'idle'
    end
    local vehicle = GetVehiclePedIsIn(ped, false)
    if GetPedInVehicleSeat(vehicle, -1) ~= ped then return 'idle' end
    local speed, bodyHealth = GetEntitySpeed(vehicle), GetVehicleBodyHealth(vehicle)
    if speed > Config.vehicleSpeed then report('vehicle.speed', { speed = speed, airborne = IsEntityInAir(vehicle) }) end
    if not GetEntityCanBeDamaged(vehicle) then report('vehicle.invulnerability', { damageable = false }) end
    if previous.vehicleHealth and bodyHealth - previous.vehicleHealth > Config.vehicleRepairIncrease then
        report('vehicle.repair', { delta = bodyHealth - previous.vehicleHealth })
    end
    local now, position = GetGameTimer(), GetEntityCoords(vehicle)
    if previous.vehicle == vehicle and previous.vehiclePosition then
        local elapsed = (now - previous.vehicleTime) / 1000.0
        local expected = math.max(speed, previous.vehicleSpeed) * elapsed + 10.0
        local excess = #(position - previous.vehiclePosition) - expected
        if excess > Config.vehicleWarpExcess then report('vehicle.warp', { excess = excess, speed = speed }) end
    end
    previous.vehicle, previous.vehiclePosition, previous.vehicleSpeed, previous.vehicleTime =
        vehicle, position, speed, now
    previous.vehicleHealth = bodyHealth

    -- The server resolves model, seat and speed itself; the sample only carries what it cannot read.
    previous.vehicleTicks = (previous.vehicleTicks or 0) + 1
    if previous.vehicleTicks >= Config.vehicleSampleTicks then
        previous.vehicleTicks = 0
        local fields = {}
        for index = 1, #Config.vehicleHandlingFields do
            local field = Config.vehicleHandlingFields[index]
            fields[field] = GetVehicleHandlingFloat(vehicle, 'CHandlingData', field)
        end
        TriggerServerEvent('simpleac:vehicle:sample', { fields = fields,
            airborne = IsEntityInAir(vehicle) or IsPedFalling(ped) })
    end
end, { maxBackoff = 3 })

-- Reports legitimate transitions so the server can open a bounded grace window (it rate-limits
-- and validates every hint; the client cannot extend or widen a window).
Scheduler.every('lifecycle', 500, 100, function()
    local ped = PlayerPedId()
    local dead = ped ~= 0 and IsEntityDead(ped)
    if previous.dead and not dead then
        previous.position, previous.vehiclePosition = nil, nil
        hint('respawn')
    end
    previous.dead = dead

    local cutscene = IsCutsceneActive()
    if cutscene then previous.position = nil end
    if cutscene and not previous.cutscene then hint('cutscene') end
    previous.cutscene = cutscene

    local loading = IsScreenFadedOut() or IsPlayerSwitchInProgress()
    if loading then previous.position, previous.vehiclePosition = nil, nil end
    if loading and not previous.loading then hint('loading') end
    previous.loading = loading

    local interior = GetInteriorFromEntity(ped)
    if interior ~= previous.interior then
        if previous.interior ~= nil then previous.position = nil hint('interior') end
        previous.interior = interior
    end
end)

return {}
