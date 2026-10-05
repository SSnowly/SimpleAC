local Config = require 'configs.shared.main'
local Scheduler = require 'client.scheduler'

---@return number, number
local function resourceInventory()
    local resources = {}
    for index = 0, GetNumResources() - 1 do
        local resourceName = GetResourceByFindIndex(index)
        if resourceName then
            local state = GetResourceState(resourceName)
            if state == 'started' or state == 'starting' then resources[#resources + 1] = resourceName end
        end
    end
    table.sort(resources)
    return GetHashKey(table.concat(resources, '\0')), #resources
end

RegisterNetEvent('simpleac:heartbeat:challenge', function(challenge)
    if Config.debug then print('[SimpleAC:client] heartbeat challenge received', type(challenge)) end
    if type(challenge) ~= 'table' or type(challenge.sequence) ~= 'number'
        or type(challenge.nonce) ~= 'string' or type(challenge.resources) ~= 'table' then return end

    local resourceStates = {}
    for index = 1, math.min(#challenge.resources, 16) do
        local resourceName = challenge.resources[index]
        if type(resourceName) == 'string' and #resourceName <= 128 then
            resourceStates[resourceName] = GetResourceState(resourceName)
        end
    end

    local inventoryHash, inventoryCount = resourceInventory()
    local scheduler = Scheduler.snapshot()
    TriggerServerEvent('simpleac:heartbeat:response', {
        sequence = challenge.sequence,
        nonce = challenge.nonce,
        clientTimer = GetGameTimer(),
        schedulerTickCount = scheduler.tickCount,
        schedulerAgeMs = scheduler.ageMs,
        schedulerMaximumGapMs = scheduler.maximumGapMs,
        components = scheduler.components,
        resources = resourceStates,
        inventoryHash = inventoryHash,
        inventoryCount = inventoryCount,
    })
    Scheduler.resetMaximumGap()
end)

return {}
