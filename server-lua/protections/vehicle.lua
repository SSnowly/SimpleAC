local Allowances = require 'server-lua.detection.allowances'
local Baseline = require 'server-lua.vehicles.baseline'
local ClientConfig = require 'configs.client.detections'
local Config = require 'configs.server.vehicles'
local Context = require 'server-lua.detection.context'
local Engine = require 'server-lua.detection.engine'
local Grace = require 'server-lua.detection.grace'
local Logger = require 'server-lua.logger'
local Sessions = require 'server-lua.services.sessions'
local M = {}

---@class VehicleState
---@field lastSample number
---@field vehicle number?
---@field overCount number
---@field lastHandlingCheck number

---@type table<number, VehicleState>
local states = {}

local allowedFields = {}
for _, field in ipairs(ClientConfig.vehicleHandlingFields) do allowedFields[field] = true end

---@param fields any
---@return table<string, number>?
local function sanitizeFields(fields)
    if type(fields) ~= 'table' then return nil end
    local clean, count = {}, 0
    for field, value in pairs(fields) do
        count = count + 1
        if count > 32 then return nil end
        if allowedFields[field] and type(value) == 'number' and value == value
            and value ~= math.huge and value ~= -math.huge then
            clean[field] = value
        end
    end
    return clean
end

---@param deviations { field: string, expected: number, actual: number }[]
---@return string
local function summarize(deviations)
    local parts = {}
    for index = 1, math.min(#deviations, 6) do
        local deviation = deviations[index]
        parts[index] = ('%s %.4g->%.4g'):format(deviation.field, deviation.expected, deviation.actual)
    end
    return table.concat(parts, ', ')
end

---@param source number
---@param sample any
function M.handleSample(source, sample)
    if type(sample) ~= 'table' or not Sessions.getActive(source) then return end

    local now = GetGameTimer()
    local state = states[source] or { lastSample = -Config.minimumSampleIntervalMs, overCount = 0,
        lastHandlingCheck = -Config.recheckMs }
    states[source] = state
    if now - state.lastSample < Config.minimumSampleIntervalMs then return end
    state.lastSample = now

    -- Model, seat and speed come from the server's view of the entity, never from the report.
    local ped = GetPlayerPed(source)
    local vehicle = ped and ped ~= 0 and GetVehiclePedIsIn(ped, false) or 0
    if vehicle == 0 or GetPedInVehicleSeat(vehicle, -1) ~= ped then
        state.vehicle, state.overCount = nil, 0
        return
    end
    if vehicle ~= state.vehicle then
        state.vehicle, state.overCount, state.lastHandlingCheck = vehicle, 0, -Config.recheckMs
    end
    if Grace.covers(source, 'vehicle') or Context.inSafeZone(source, 'vehicle')
        or Allowances.isAllowed(source, 'vehicle.baseline', nil) then
        state.overCount = 0
        return
    end

    local entry = Baseline.find(GetEntityModel(vehicle))
    if not entry or not Config.checkedTypes[entry.vehicle.type] then return end

    local fields = sanitizeFields(sample.fields)
    if fields and next(fields) and now - state.lastHandlingCheck >= Config.recheckMs then
        state.lastHandlingCheck = now
        local deviations = Baseline.compare(entry.handling, fields)
        if #deviations >= Config.minimumDeviatingFields then
            Engine.submit({ rule = 'vehicle.handling_modified', source = source, measured = {
                model = entry.model, deviations = #deviations, worst = deviations[1].field,
                expected = deviations[1].expected, actual = deviations[1].actual, summary = summarize(deviations),
            } })
        end
    end

    local ceiling = Baseline.speedCeiling(entry.handling)
    if not ceiling or sample.airborne == true then
        state.overCount = 0
        return
    end
    local velocity = GetEntityVelocity(vehicle)
    local speed = math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
    if speed > ceiling then
        state.overCount = state.overCount + 1
        if state.overCount >= Config.sustainedSamples then
            state.overCount = 0
            Engine.submit({ rule = 'vehicle.boost', source = source, measured = {
                model = entry.model, speed = speed, ceiling = ceiling, ratio = speed / ceiling,
            } })
        end
    else
        state.overCount = 0
    end
end

function M.start()
    local loaded = Baseline.ensure()
    Logger.structured(loaded and 'info' or 'warn', 'vehicle_baseline_loaded', Baseline.stats())
    RegisterNetEvent('simpleac:vehicle:sample', function(sample) M.handleSample(source, sample) end)
    AddEventHandler('playerDropped', function() states[source] = nil end)
end

return M
