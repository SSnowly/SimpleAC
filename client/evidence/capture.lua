local ENCODINGS = { jpg = true, webp = true, png = true }

---@param value any
---@param minimum number
---@param maximum number
---@return number?
local function bounded(value, minimum, maximum)
    if type(value) ~= 'number' or value ~= value then return nil end
    return math.max(minimum, math.min(maximum, value))
end

-- The server asks for a screenshot and supplies a single-use token. The NUI module renders the game view and encodes
-- it, then either uploads it straight to the resource over HTTPS (when the server offers that) or hands it back here
-- to be sent as a latent event, never as an ordinary net event.
---@type table<string, { token: string, bytesPerSecond: number }>
local requests = {}

RegisterNetEvent('simpleac:capture:request', function(request)
    if type(request) ~= 'table' or type(request.id) ~= 'string' or #request.id > 40 then return end
    if type(request.token) ~= 'string' or #request.token ~= 64 then return end
    if not ENCODINGS[request.encoding] then return end
    local uploadUrl = type(request.uploadUrl) == 'string' and #request.uploadUrl <= 512
        and request.uploadUrl:sub(1, 8) == 'https://' and request.uploadUrl or nil

    requests[request.id] = {
        token = request.token,
        bytesPerSecond = bounded(request.bytesPerSecond, 32768, 2097152) or 262144,
    }

    SendNUIMessage({
        action = 'simpleac:capture',
        request = {
            id = request.id,
            -- Direct HTTPS upload when the server offers one; otherwise the image comes back to Lua (captureData).
            url = uploadUrl,
            encoding = request.encoding,
            quality = bounded(request.quality, 0.3, 1.0) or 0.8,
            maxWidth = bounded(request.maxWidth, 320, 3840) or 1920,
        },
    })
end)

-- Sends a screenshot to the server as a latent event: it is split into chunks at the configured bandwidth instead of
-- flooding the connection like a normal net event would.
RegisterNUICallback('captureData', function(data, cb)
    cb({})
    if type(data) ~= 'table' or type(data.id) ~= 'string' or type(data.mediaType) ~= 'string' then return end
    if type(data.data) ~= 'string' or #data.data == 0 then return end
    local request = requests[data.id]
    if not request then return end
    requests[data.id] = nil
    TriggerLatentServerEvent('simpleac:capture:data', request.bytesPerSecond, data.id, request.token, data.mediaType,
        data.data)
end)

RegisterNUICallback('captureResult', function(data, cb)
    cb({})
    if type(data) ~= 'table' or type(data.id) ~= 'string' or data.ok ~= false then return end
    requests[data.id] = nil
    TriggerServerEvent('simpleac:capture:failed', data.id, type(data.error) == 'string' and data.error or 'unknown')
end)
