-- The server cancels damage it rejects, which this client has often already applied locally (it looks like a kill
-- here while nobody else sees any damage). The server then sends the victim's real state, which is applied here.
RegisterNetEvent('simpleac:combat:restore', function(netId, health, armour)
    if type(netId) ~= 'number' or type(health) ~= 'number' or type(armour) ~= 'number' then return end
    if not NetworkDoesNetworkIdExist(netId) then return end

    local ped = NetworkGetEntityFromNetworkId(netId)
    if ped == 0 or not DoesEntityExist(ped) or not IsEntityAPed(ped) then return end

    if health > 0 and IsPedDeadOrDying(ped, true) then
        ResurrectPed(ped)
        ClearPedTasksImmediately(ped)
    end
    SetEntityHealth(ped, math.floor(health))
    SetPedArmour(ped, math.floor(armour))
end)
