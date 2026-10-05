local Allowances = require 'server-lua.detection.allowances'
local Config = require 'configs.server.combat'
local DryRun = require 'server-lua.enforcement.dry_run'
local Engine = require 'server-lua.detection.engine'
local Inventory = require 'bridge.weapon_inventory'
local M = {}

---@type table<number, table<number, { value: boolean?, expiresAt: number }>>
local ownership = {}
local recentShots = {}
local damageWindows = {}

---@param weaponHash number
---@return table?
local function weaponDefinition(weaponHash)
    local configured = Config.weapons[weaponHash]
    local catalog = Inventory.catalog()
    local discovered = catalog and catalog[weaponHash]
    if configured and discovered then
        configured.item = discovered.item
        configured.ammoItem = discovered.ammoItem
    end
    return configured or discovered
end

---@param source number
---@param weaponHash number
---@return boolean?
local function ownsWeapon(source, weaponHash)
    local definition = weaponDefinition(weaponHash)
    if not definition then return nil end
    local now = GetGameTimer()
    ownership[source] = ownership[source] or {}
    local cached = ownership[source][weaponHash]
    if cached and cached.expiresAt > now then return cached.value end
    local value = Inventory.hasWeapon(source, definition.item)
    ownership[source][weaponHash] = { value = value, expiresAt = now + Config.ownershipCacheMs }
    return value
end

---@param source number
---@param rule string
---@param measured table<string, string|number|boolean>
---@return table
local function submit(source, rule, measured)
    return Engine.submit({ rule = rule, source = source, measured = measured })
end

---@param source number
---@param weaponHash number
---@param origin string
local function validateWeapon(source, weaponHash, origin)
    if Allowances.isAllowed(source, 'combat.weapon', nil) then return false end
    local definition = weaponDefinition(weaponHash)
    local shouldCancel = false
    if definition and definition.blacklisted then
        shouldCancel = submit(source, 'combat.weapon_blacklisted', { weapon = weaponHash, origin = origin }).cancel
    end
    if definition and ownsWeapon(source, weaponHash) == false then
        submit(source, 'combat.weapon_not_owned', {
            weapon = weaponHash,
            item = definition.item,
            provider = Inventory.provider(),
            origin = origin,
        })
    end
    return shouldCancel
end

---@param source number
---@param weaponHash number
---@param ammo number
---@param components table
local function validateLoadout(source, weaponHash, ammo, components)
    if Allowances.isAllowed(source, 'combat.loadout', nil) then return end
    local definition = weaponDefinition(weaponHash)
    if not definition or type(ammo) ~= 'number' or ammo < 0 or ammo > 100000 or type(components) ~= 'table' then return end
    local slots = Inventory.weaponSlots(source, definition.item)
    if type(slots) ~= 'table' then return end
    local maximumAmmo, ownedComponents = 0, {}
    for index = 1, #slots do
        local metadata = type(slots[index].metadata) == 'table' and slots[index].metadata or {}
        maximumAmmo = math.max(maximumAmmo, tonumber(metadata.ammo) or 0)
        if type(metadata.components) == 'table' then
            for componentIndex = 1, #metadata.components do ownedComponents[metadata.components[componentIndex]] = true end
        end
    end
    if ammo > maximumAmmo + Config.ammoTolerance then
        submit(source, 'combat.ammo_invalid', { weapon = weaponHash, ammo = ammo, maximum = maximumAmmo })
    end
    for index = 1, math.min(#components, 32) do
        local component = components[index]
        if type(component) ~= 'string' or #component > 64 or not ownedComponents[component] then
            submit(source, 'combat.weapon_component_invalid', {
                weapon = weaponHash, component = type(component) == 'string' and component or 'invalid',
            })
            break
        end
    end
end

function M.start()
    RegisterNetEvent('simpleac:combat:equipped', function(weaponHash, ammo, components)
        local playerSource = source
        if type(weaponHash) ~= 'number' or GetPlayerName(playerSource) == nil then return end
        SetTimeout(Config.equipGraceMs, function()
            if GetPlayerName(playerSource) == nil then return end
            local ped = GetPlayerPed(playerSource)
            if ped == 0 or GetSelectedPedWeapon(ped) ~= weaponHash then return end
            validateWeapon(playerSource, weaponHash, 'equipped')
            validateLoadout(playerSource, weaponHash, ammo, components)
        end)
    end)

    RegisterNetEvent('simpleac:combat:shot', function(weaponHash)
        local playerSource = source
        if type(weaponHash) ~= 'number' or GetPlayerName(playerSource) == nil then return end
        local ped = GetPlayerPed(playerSource)
        if ped == 0 or GetSelectedPedWeapon(ped) ~= weaponHash then return end
        local now = GetGameTimer()
        local state = recentShots[playerSource]
        if not state or now - state.windowStarted >= 1000 then
            state = { weapon = weaponHash, lastAt = now, windowStarted = now, count = 0 }
        end
        state.weapon, state.lastAt, state.count = weaponHash, now, state.count + 1
        recentShots[playerSource] = state
    end)

    AddEventHandler('weaponDamageEvent', function(sender, data)
        local playerSource = tonumber(sender)
        if not playerSource or GetPlayerName(playerSource) == nil or type(data) ~= 'table'
            or type(data.weaponType) ~= 'number' then return end
        local weaponHash = data.weaponType
        if validateWeapon(playerSource, weaponHash, 'damage') and not DryRun.active() then CancelEvent() return end

        local attackerPed = GetPlayerPed(playerSource)
        if attackerPed ~= 0 then
            local equippedWeapon = GetSelectedPedWeapon(attackerPed)
            if equippedWeapon ~= weaponHash then
                submit(playerSource, 'combat.weapon_mismatch', {
                    weapon = weaponHash, equippedWeapon = equippedWeapon,
                })
            end
        end

        local now = GetGameTimer()
        local shot = recentShots[playerSource]
        if not Allowances.isAllowed(playerSource, 'combat.damage', nil)
            and (not shot or shot.weapon ~= weaponHash or now - shot.lastAt > Config.shotCorrelationMs) then
            submit(playerSource, 'combat.damage_without_shot', { weapon = weaponHash, ageMs = shot and now - shot.lastAt or -1 })
        end
        local damageWindow = damageWindows[playerSource] or { started = now, count = 0 }
        if now - damageWindow.started >= 1000 then damageWindow = { started = now, count = 0 } end
        damageWindow.count = damageWindow.count + 1
        damageWindows[playerSource] = damageWindow
        if damageWindow.count > Config.maximumDamageEventsPerSecond then
            submit(playerSource, 'combat.hit_rate', {
                weapon = weaponHash, count = damageWindow.count, maximum = Config.maximumDamageEventsPerSecond,
            })
        end

        if Config.invalidPlayerDamageWeapons[weaponHash] then
            local decision = submit(playerSource, 'combat.damage_type_invalid', { weapon = weaponHash })
            if decision.cancel then CancelEvent() end
            return
        end

        local definition = weaponDefinition(weaponHash)
        if not definition or Allowances.isAllowed(playerSource, 'combat.damage', nil) then return end
        if definition.maxDamage and data.overrideDefaultDamage == true and type(data.weaponDamage) == 'number'
            and data.weaponDamage > definition.maxDamage + Config.damageTolerance then
            local decision = submit(playerSource, 'combat.damage_excessive', {
                weapon = weaponHash, damage = data.weaponDamage, maximum = definition.maxDamage,
            })
            if decision.cancel then CancelEvent() end
        end

        if definition.maxDistance and type(data.hitGlobalId) == 'number' and data.hitGlobalId > 0 then
            local victim = NetworkGetEntityFromNetworkId(data.hitGlobalId)
            local attacker = attackerPed
            if victim ~= 0 and attacker ~= 0 and DoesEntityExist(victim) and DoesEntityExist(attacker) then
                local distance = #(GetEntityCoords(attacker) - GetEntityCoords(victim))
                if distance > definition.maxDistance + Config.distanceTolerance then
                    local decision = submit(playerSource, 'combat.damage_distance', {
                        weapon = weaponHash, distance = distance, maximum = definition.maxDistance,
                    })
                    if decision.cancel then CancelEvent() end
                end
            end
        end
    end)

    AddEventHandler('playerDropped', function()
        ownership[source], recentShots[source], damageWindows[source] = nil, nil, nil
    end)
end

return M
