local Logger = require 'server-lua.logger'
local M = {}

local READY_WAIT_MS = 15000
local RESCAN_DEBOUNCE_MS = 2000

---@alias WeaponEntry table<string, any>

---@type { byHash: table<number, { name: string, entry: WeaponEntry }>, counts: { base: number, scanned: number, custom: number } }?
local index
local rescanAt = 0

---@param name string
---@return table?
local function readDocument(name)
    local raw = LoadResourceFile(GetCurrentResourceName(), name)
    if type(raw) ~= 'string' or raw == '' then return nil end
    local ok, document = pcall(json.decode, raw)
    return ok and type(document) == 'table' and document or nil
end

---@param weapons table?
---@return table<string, WeaponEntry>
local function lowered(weapons)
    local result = {}
    for name, entry in pairs(weapons or {}) do
        if type(name) == 'string' and type(entry) == 'table' then result[name:lower()] = entry end
    end
    return result
end

---@param base table?
---@param scanned table?
---@param custom table?
local function build(base, scanned, custom)
    local baseWeapons, scannedWeapons, customWeapons = lowered(base and base.weapons), lowered(scanned),
        lowered(custom and custom.weapons)
    local merged, counts = {}, { base = 0, scanned = 0, custom = 0 }

    local layers = {
        { 'base', baseWeapons }, { 'scanned', scannedWeapons }, { 'custom', customWeapons },
    }
    for _, pair in ipairs(layers) do
        local layer, weapons = pair[1], pair[2]
        for name, entry in pairs(weapons) do
            counts[layer] = counts[layer] + 1
            local target = merged[name] or {}
            merged[name] = target
            for key, value in pairs(entry) do target[key] = value end
            if layer ~= 'base' then target.source = layer == 'custom' and 'custom' or (entry.source or 'scanned') end
        end
    end

    local byHash = {}
    for name, entry in pairs(merged) do
        entry.hash = GetHashKey(name) & 0xFFFFFFFF
        byHash[entry.hash] = { name = name, entry = entry }
    end
    index = { byHash = byHash, counts = counts }
end

---Installs documents directly (used by tests).
---@param base table?
---@param scanned table?
---@param custom table?
function M.use(base, scanned, custom) build(base, scanned, custom) end

---@return table?
local function scan()
    local ok, scanned = pcall(function() return exports[GetCurrentResourceName()]:ScanWeaponMeta() end)
    return ok and type(scanned) == 'table' and scanned or nil
end

---@return boolean loaded Whether the generated baseline file was found and parsed.
function M.ensure()
    if index then return true end
    local base = readDocument('shared/data/weapon-baselines.json')
    build(base, nil, readDocument('shared/data/weapon-baselines.custom.json'))
    return base ~= nil
end

---Rebuilds the table from the baseline, weapons found in other resources, and the server's own overrides.
---@return boolean scanned Whether the resource scan answered.
function M.reload()
    local scanned = scan()
    build(readDocument('shared/data/weapon-baselines.json'), scanned,
        readDocument('shared/data/weapon-baselines.custom.json'))
    return scanned ~= nil
end

---@return { base: number, scanned: number, custom: number, total: number }
function M.stats()
    M.ensure()
    local total = 0
    for _ in pairs(index.byHash) do total = total + 1 end
    return { base = index.counts.base, scanned = index.counts.scanned, custom = index.counts.custom, total = total }
end

---@param weaponHash number
---@return { name: string, entry: WeaponEntry }?
function M.find(weaponHash)
    M.ensure()
    return index.byHash[weaponHash & 0xFFFFFFFF]
end

---Highest plausible values for one weapon, derived from its meta fields. Any value may be nil when the weapon
---does not define it (explosives, thrown weapons) so callers skip that check.
---@param entry WeaponEntry
---@param options { rangeMultiplier: number, headshotMultiplier: number }
---@return { maxDamage: number?, headshotMultiplier: number, maxDistance: number? }
function M.limits(entry, options)
    local damage = tonumber(entry.Damage)
    local maxDamage
    if damage and damage > 0 then
        local scale = math.max(tonumber(entry.NetworkPlayerDamageModifier) or 1.0,
            tonumber(entry.NetworkPedDamageModifier) or 1.0, 1.0)
        maxDamage = damage * scale
    end

    local headshot = options.headshotMultiplier
    if entry.HeadShotDamageModifierPlayer or entry.HeadShotDamageModifierAI then
        headshot = math.max(tonumber(entry.HeadShotDamageModifierPlayer) or 1.0,
            tonumber(entry.HeadShotDamageModifierAI) or 1.0, 1.0)
    end

    local range = tonumber(entry.WeaponRange) or 0.0
    return {
        maxDamage = maxDamage,
        headshotMultiplier = headshot,
        maxDistance = range > 0 and range * options.rangeMultiplier or nil,
    }
end

function M.start()
    CreateThread(function()
        local deadline = GetGameTimer() + READY_WAIT_MS
        repeat
            if M.reload() then break end
            Wait(250)
        until GetGameTimer() >= deadline
        local stats = M.stats()
        Logger.structured('info', 'weapon_baseline_ready', stats)
    end)

    -- Other resources can ship weapon meta files; pick them up shortly after they start or stop.
    local function schedule(resource)
        if resource == GetCurrentResourceName() then return end
        local at = GetGameTimer() + RESCAN_DEBOUNCE_MS
        rescanAt = at
        SetTimeout(RESCAN_DEBOUNCE_MS, function()
            if rescanAt == at then M.reload() end
        end)
    end
    AddEventHandler('onServerResourceStart', schedule)
    AddEventHandler('onResourceStop', schedule)
end

return M
