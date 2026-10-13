local Context = require 'server-lua.detection.context'
local Engine = require 'server-lua.detection.engine'
local Grace = require 'server-lua.detection.grace'
local Sessions = require 'server-lua.services.sessions'
local Config = require 'configs.server.movement'
local Logger = require 'server-lua.logger'
local M = {}

---@class MovementState
---@field position vector3
---@field at number
---@field overCount number
---@field skipped string?

---@type table<number, MovementState>
local states = {}

---@param source number
local function sample(source)
    local ped = GetPlayerPed(source)
    if not ped or ped == 0 then
        states[source] = nil
        return
    end

    local now = GetGameTimer()
    local position = GetEntityCoords(ped)
    local state = states[source]
    states[source] = { position = position, at = now, overCount = state and state.overCount or 0,
        skipped = state and state.skipped or nil }
    if not state then return end

    local seconds = (now - state.at) / 1000
    if seconds < 0.5 then
        states[source].at = state.at
        states[source].position = state.position
        return
    end

    local skip = (not Sessions.getActive(source) and 'no_session') or (GetEntityHealth(ped) <= 0 and 'dead')
        or (Grace.covers(source, 'movement') and 'grace') or (Context.inSafeZone(source, 'movement') and 'safe_zone')
    states[source].skipped = skip or nil
    if skip then
        if Config.debugLog and state.skipped ~= skip then
            Logger.structured('info', 'movement_skipped', { source = source, reason = skip })
        end
        states[source].overCount = 0
        return
    end

    local dx, dy = position.x - state.position.x, position.y - state.position.y
    local distance = math.sqrt(dx * dx + dy * dy)
    if distance > Config.teleportDistance then
        -- A single huge jump is a teleport (respawn, routing, admin tools), not sustained flight.
        states[source].overCount = 0
        return
    end

    local speed = distance / seconds
    if Config.debugLog and speed > 10 then
        Logger.structured('info', 'movement_sample', { source = source, speed = speed, distance = distance })
    end
    local inVehicle = GetVehiclePedIsIn(ped, false) ~= 0
    local limit = inVehicle and Config.vehicleSpeed or Config.footSpeed
    if speed <= limit then
        states[source].overCount = 0
        return
    end

    local current = states[source]
    current.overCount = current.overCount + 1
    if current.overCount < Config.consecutiveSamples then return end

    local decision = Engine.submit({
        rule = 'movement.server_speed',
        source = source,
        measured = { speed = speed, limit = limit, samples = current.overCount, inVehicle = inVehicle },
    })
    if Config.debugLog then
        Logger.structured('info', 'movement_submitted', { source = source, accepted = decision.accepted, reason = decision.reason, outcome = decision.outcome })
    end
end

function M.start()
    CreateThread(function()
        while true do
            Wait(Config.intervalMs)
            for _, playerId in ipairs(GetPlayers()) do
                local source = tonumber(playerId)
                if source then sample(source) end
            end
        end
    end)
    AddEventHandler('playerDropped', function() states[source] = nil end)
end

return M
