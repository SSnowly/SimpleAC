-- Live watch. The server only relays the WebRTC handshake: this client turns the game view into a video stream when
-- staff watch this player, and passes the staff member's answer back to the NUI page that sends the video.
local MAX_SDP = 24000

---@type string?
local streaming

local function validSession(id)
    return type(id) == 'string' and #id > 0 and #id <= 40
end

---The server asks this player's game to start streaming to a staff member.
RegisterNetEvent('simpleac:watch:begin', function(params)
    if type(params) ~= 'table' or not validSession(params.id) or type(params.iceServers) ~= 'table' then return end
    streaming = params.id
    SendNUIMessage({
        action = 'simpleac:watch:begin',
        params = {
            id = params.id,
            iceServers = params.iceServers,
            relayOnly = params.relayOnly == true,
            fps = tonumber(params.fps) or 15,
            width = tonumber(params.width) or 1280,
            bitrateKbps = tonumber(params.bitrateKbps) or 1500,
        },
    })
end)

---An offer is for the staff member's panel; an answer is for the game that sends the video.
RegisterNetEvent('simpleac:watch:signal', function(id, kind, sdp)
    if not validSession(id) or type(sdp) ~= 'string' or #sdp > MAX_SDP then return end
    if kind == 'answer' and id == streaming then
        SendNUIMessage({ action = 'simpleac:watch:answer', id = id, sdp = sdp })
    elseif kind == 'offer' then
        SendNUIMessage({ action = 'simpleac:panel:watch', event = { type = 'offer', id = id, sdp = sdp } })
    end
end)

RegisterNetEvent('simpleac:watch:end', function(id, role, reason)
    if not validSession(id) then return end
    if role == 'target' then
        if id == streaming then streaming = nil end
        SendNUIMessage({ action = 'simpleac:watch:end', id = id })
    else
        SendNUIMessage({
            action = 'simpleac:panel:watch',
            event = { type = 'ended', id = id, reason = type(reason) == 'string' and reason:sub(1, 40) or 'ended' },
        })
    end
end)

---The streaming page created its offer.
RegisterNUICallback('watchSignal', function(data, cb)
    cb({})
    if type(data) ~= 'table' or data.id ~= streaming or data.kind ~= 'offer' then return end
    if type(data.sdp) ~= 'string' or #data.sdp > MAX_SDP then return end
    TriggerServerEvent('simpleac:watch:signal', data.id, 'offer', data.sdp)
end)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName == GetCurrentResourceName() and streaming then
        SendNUIMessage({ action = 'simpleac:watch:end', id = streaming })
    end
end)
