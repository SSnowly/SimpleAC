-- The staff panel. The server decides who may open it and authorizes every request; this file only moves messages
-- between the NUI page and the server, and keeps the game's input focus in step with the panel.
local isOpen = false
local lastOpenRequest = 0

local MAX_PAYLOAD = 32000

local function notify(message)
    SetNotificationTextEntry('STRING')
    AddTextComponentString(message)
    DrawNotification(false, false)
end

local function closePanel()
    if not isOpen then return end
    isOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({ action = 'simpleac:panel:close' })
end

local function requestOpen()
    if isOpen then
        closePanel()
        return
    end
    local now = GetGameTimer()
    if now - lastOpenRequest < 1000 then return end
    lastOpenRequest = now
    TriggerServerEvent('simpleac:panel:open')
end

RegisterCommand('simpleac', requestOpen, false)
RegisterCommand('simpleac_panel', requestOpen, false)
RegisterKeyMapping('simpleac_panel', locale('brand.panel_key'), 'keyboard', 'F10')

RegisterNetEvent('simpleac:panel:granted', function(session)
    if type(session) ~= 'table' or type(session.staff) ~= 'table' then return end
    isOpen = true
    SetNuiFocus(true, true)
    -- The panel shows the server's language: ox_lib's locale (English underneath) travels with the session.
    SendNUIMessage({ action = 'simpleac:panel:open', session = session, strings = lib.getLocales() })
end)

RegisterNetEvent('simpleac:panel:denied', function()
    notify(locale('panel.denied'))
end)

RegisterNetEvent('simpleac:panel:res', function(reply)
    if not isOpen or type(reply) ~= 'table' then return end
    SendNUIMessage({ action = 'simpleac:panel:res', reply = reply })
end)

RegisterNetEvent('simpleac:panel:warned', function(reason)
    if type(reason) ~= 'string' then return end
    notify(locale('panel.warned', reason:sub(1, 200)))
end)

---A request from the NUI: forwarded to the server, which answers with `simpleac:panel:res`.
RegisterNUICallback('panelRequest', function(data, cb)
    cb({})
    if not isOpen or type(data) ~= 'table' then return end
    if math.type(data.id) ~= 'integer' or type(data.op) ~= 'string' or #data.op > 40 then return end
    local payload = type(data.payload) == 'table' and data.payload or {}
    if #json.encode(payload) > MAX_PAYLOAD then return end
    TriggerServerEvent('simpleac:panel:req', data.id, data.op, payload)
end)

---The panel finished its closing animation.
RegisterNUICallback('panelClosed', function(_, cb)
    cb({})
    if isOpen then
        isOpen = false
        SetNuiFocus(false, false)
    end
end)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName == GetCurrentResourceName() and isOpen then SetNuiFocus(false, false) end
end)
