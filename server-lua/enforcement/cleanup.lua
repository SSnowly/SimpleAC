local Config = require 'configs.server.cleanup'
local Protections = require 'configs.server.protections'
local Logger = require 'server-lua.logger'
local Sessions = require 'server-lua.services.sessions'
local M = {}

local MAX_RECORDS = 300

---@class KillRecord
---@field killerId string SimpleAC player id
---@field victimId string SimpleAC player id
---@field at number
---@field revived boolean

---@type KillRecord[]
local kills = {}

---@param vehicle number
---@return boolean
local function hasPlayerOccupant(vehicle)
    for seat = -1, 6 do
        local ped = GetPedInVehicleSeat(vehicle, seat)
        if ped ~= 0 and IsPedAPlayer(ped) then return true end
    end
    return false
end

---Deletes script-created vehicles, peds and objects whose network owner is the player. The game's own
---population is skipped (same list the entity protection uses), as are other players and occupied vehicles.
---@param source number
---@return number deleted
local function deleteOwned(source)
    local ownPed = GetPlayerPed(source)
    local ignored = Protections.entity.ignoredPopulationTypes or {}
    local deleted = 0

    for _, list in ipairs({ GetAllVehicles(), GetAllPeds(), GetAllObjects() }) do
        for _, entity in ipairs(list) do
            if entity ~= ownPed
                and DoesEntityExist(entity)
                and NetworkGetEntityOwner(entity) == source
                and not ignored[GetEntityPopulationType(entity)]
                and not (GetEntityType(entity) == 1 and IsPedAPlayer(entity))
                and not (GetEntityType(entity) == 2 and hasPlayerOccupant(entity))
            then
                DeleteEntity(entity)
                deleted = deleted + 1
            end
        end
    end
    return deleted
end

---@param playerId string
---@return number revived
local function reviveVictims(playerId)
    local cutoff = GetGameTimer() - Config.victimWindowSeconds * 1000
    local revived = 0
    for _, record in ipairs(kills) do
        if record.killerId == playerId and not record.revived and record.at >= cutoff then
            local victim = Sessions.findSource(record.victimId)
            if victim and GetPlayerName(victim) ~= nil then
                TriggerClientEvent(Config.reviveEvent, victim)
                record.revived = true
                revived = revived + 1
            end
        end
    end
    return revived
end

---@param playerId string
---@param options? { entities?: boolean, victims?: boolean }
---@return { entities: number, revived: number }
function M.run(playerId, options)
    options = options or {}
    local result = { entities = 0, revived = 0 }

    if options.entities ~= false then
        local source = Sessions.findSource(playerId)
        if source then result.entities = deleteOwned(source) end
    end
    if options.victims ~= false then
        result.revived = reviveVictims(playerId)
    end

    Logger.structured('info', 'player_cleanup', {
        playerId = playerId,
        entities = result.entities,
        revived = result.revived,
    })
    return result
end

---Runs the automatic cleanup configured for enforcement, if any. Never raises.
---@param source number
function M.automatic(source)
    local settings = Config.automatic
    if not settings or not settings.enabled then return end
    local session = Sessions.getActive(source)
    if not session then return end
    local ok, err = pcall(M.run, session.playerId, {
        entities = settings.deleteEntities,
        victims = settings.reviveVictims,
    })
    if not ok then Logger.structured('warn', 'player_cleanup_failed', { error = tostring(err) }) end
end

function M.start()
    -- baseevents reports kills from the victim's client; the killer id is a server id (or -1).
    RegisterNetEvent('baseevents:onPlayerKilled', function(killerSource)
        local victim = source
        if type(killerSource) ~= 'number' or killerSource <= 0 or killerSource == victim then return end

        local killerSession = Sessions.getActive(killerSource)
        local victimSession = Sessions.getActive(victim)
        if not killerSession or not victimSession then return end

        kills[#kills + 1] = {
            killerId = killerSession.playerId,
            victimId = victimSession.playerId,
            at = GetGameTimer(),
            revived = false,
        }
        if #kills > MAX_RECORDS then table.remove(kills, 1) end
    end)

    exports('InternalPanelCleanup', function(playerId)
        if GetInvokingResource() ~= GetCurrentResourceName() or type(playerId) ~= 'string' then return nil end
        return M.run(playerId)
    end)
end

return M
