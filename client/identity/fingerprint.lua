local Config = require 'configs.client.detections'

local settings = Config.fingerprint
if not settings.enabled then return end

local KVP_KEY = 'simpleac:device'
local acknowledged = false
local storageToken = nil

---@param first string?
---@param second string?
---@return string[]
local function tokenList(first, second)
    local tokens = {}
    for _, token in ipairs({ first or '', second or '' }) do
        if #token == 64 and token ~= tokens[1] then tokens[#tokens + 1] = token end
    end
    return tokens
end

RegisterNUICallback('fingerprint', function(data, cb)
    cb({})
    if type(data) ~= 'table' or type(data.attributes) ~= 'table' then return end

    storageToken = type(data.storageToken) == 'string' and data.storageToken or nil
    TriggerServerEvent('simpleac:fingerprint:submit', {
        attributes = data.attributes,
        tokens = tokenList(GetResourceKvpString(KVP_KEY), storageToken),
    })
end)

-- The server answers every accepted submission. It includes a token only when it issued a new one; otherwise
-- a token we presented was recognised, so whichever store lacks it is refilled from the other.
RegisterNetEvent('simpleac:fingerprint:ack', function(token)
    acknowledged = true
    local stored = GetResourceKvpString(KVP_KEY)
    local current = type(token) == 'string' and #token == 64 and token or nil
    if not current then
        if stored and #stored == 64 then
            current = stored
        elseif storageToken and #storageToken == 64 then
            current = storageToken
        end
    end
    if not current then return end
    if current ~= stored then SetResourceKvp(KVP_KEY, current) end
    SendNUIMessage({ action = 'simpleac:fingerprint:store', token = current })
end)

CreateThread(function()
    Wait(settings.delayMs)
    -- One retry covers a NUI page that was not ready yet or a submission the server could not process in time.
    for _ = 1, 2 do
        SendNUIMessage({ action = 'simpleac:fingerprint:collect' })
        Wait(settings.retryMs)
        if acknowledged then return end
    end
end)
