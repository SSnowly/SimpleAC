local Config = require 'configs.server.vehicles'
local M = {}

---@type { handlings: table<string, table>, byHash: table<number, { model: string, vehicle: table }> }?
local index

---@param name string
---@return table?
local function readDocument(name)
    local raw = LoadResourceFile(GetCurrentResourceName(), name)
    if type(raw) ~= 'string' or raw == '' then return nil end
    local ok, document = pcall(json.decode, raw)
    return ok and type(document) == 'table' and document or nil
end

---@param base table?
---@param custom table?
local function build(base, custom)
    local baseVehicles = base and base.vehicles or {}
    local handlings, byHash = {}, {}
    for name, handling in pairs(base and base.handlings or {}) do handlings[name] = handling end
    for name, overrides in pairs(custom and custom.handlings or {}) do
        local merged = {}
        for key, value in pairs(handlings[name:upper()] or {}) do merged[key] = value end
        for key, value in pairs(overrides) do merged[key] = value end
        handlings[name:upper()] = merged
    end

    for model, vehicle in pairs(baseVehicles) do
        byHash[vehicle.hash] = { model = model, vehicle = vehicle }
    end
    for model, overrides in pairs(custom and custom.vehicles or {}) do
        local lower = model:lower()
        local merged = {}
        for key, value in pairs(baseVehicles[lower] or {}) do merged[key] = value end
        for key, value in pairs(overrides) do merged[key] = value end
        merged.hash = merged.hash or (GetHashKey(lower) & 0xFFFFFFFF)
        if type(merged.handlingId) == 'string' then merged.handlingId = merged.handlingId:upper() end
        byHash[merged.hash] = { model = lower, vehicle = merged }
    end
    index = { handlings = handlings, byHash = byHash }
end

---Installs documents directly (used by tests).
---@param base table?
---@param custom table?
function M.use(base, custom) build(base, custom) end

---@return boolean loaded Whether the generated baseline file was found and parsed.
function M.ensure()
    if index then return true end
    local base = readDocument('shared/data/vehicle-baselines.json')
    build(base, readDocument('shared/data/vehicle-baselines.custom.json'))
    return base ~= nil
end

---@return { vehicles: number, handlings: number }
function M.stats()
    M.ensure()
    local vehicles, handlings = 0, 0
    for _ in pairs(index.byHash) do vehicles = vehicles + 1 end
    for _ in pairs(index.handlings) do handlings = handlings + 1 end
    return { vehicles = vehicles, handlings = handlings }
end

function M.reload()
    index = nil
    return M.ensure()
end

---@param modelHash number
---@return { model: string, vehicle: table, handling: table }?
function M.find(modelHash)
    M.ensure()
    local entry = index.byHash[modelHash & 0xFFFFFFFF]
    if not entry then return nil end
    local handling = index.handlings[entry.vehicle.handlingId]
    if not handling then return nil end
    return { model = entry.model, vehicle = entry.vehicle, handling = handling }
end

---@param handling table
---@param fields table<string, number>
---@return { field: string, expected: number, actual: number }[]
function M.compare(handling, fields)
    local deviations = {}
    for field, options in pairs(Config.fields) do
        local actual, base = fields[field], handling[field]
        if type(actual) == 'number' and type(base) == 'number' then
            local expected = base * (options.scale or 1.0)
            local tolerance = math.max(math.abs(expected) * (options.tolerance or Config.handlingTolerance),
                Config.absoluteEpsilon)
            if math.abs(actual - expected) > tolerance then
                deviations[#deviations + 1] = { field = field, expected = expected, actual = actual }
            end
        end
    end
    table.sort(deviations, function(a, b) return a.field < b.field end)
    return deviations
end

---Highest plausible ground speed in m/s, or nil when the model has no drive limit to compare against.
---@param handling table
---@return number?
function M.speedCeiling(handling)
    local flatVelocity = handling.fInitialDriveMaxFlatVel
    if type(flatVelocity) ~= 'number' or flatVelocity <= 0 then return nil end
    return flatVelocity * Config.fields.fInitialDriveMaxFlatVel.scale / 3.6
        * Config.speedCeilingMultiplier + Config.speedMarginMps
end

return M
