local Config = require 'configs.server.permits'
local Engine = require 'server-lua.detection.engine'
local Logger = require 'server-lua.logger'
local M = {}

---@class Permit
---@field kind string
---@field resource string
---@field expiresAt number

---@type table<number, Permit[]>
local playerPermits = {}
---@type Permit[]
local serverPermits = {}
---@type table<number, { startedAt: number, count: number }>
local rates = {}

---@param list Permit[]
---@param now number
local function prune(list, now)
    for index = #list, 1, -1 do
        if list[index].expiresAt <= now then table.remove(list, index) end
    end
end

---@param list Permit[]
---@param kind string
---@return boolean
local function take(list, kind)
    local now = GetGameTimer()
    prune(list, now)
    for index = 1, #list do
        if list[index].kind == kind then
            table.remove(list, index)
            return true
        end
    end
    return false
end

---@param resource any
---@return boolean
local function validResource(resource)
    if type(resource) ~= 'string' or #resource == 0 or #resource > 64 then return false end
    if GetResourceState(resource) ~= 'started' then return false end
    if next(Config.allowedResources) ~= nil and not Config.allowedResources[resource] then return false end
    return true
end

---@param source number
---@param kind string
---@param resource string
---@return boolean
function M.grant(source, kind, resource)
    local ttl = Config.ttlMs[kind]
    if not ttl or not validResource(resource) then
        if Config.debugLog then
            Logger.structured('info', 'permit_rejected', { source = source, kind = tostring(kind), resource = tostring(resource) })
        end
        return false
    end

    local now = GetGameTimer()
    local window = rates[source]
    if not window or now - window.startedAt >= Config.windowMs then
        window = { startedAt = now, count = 0 }
        rates[source] = window
    end
    window.count = window.count + 1
    if window.count > Config.maximumPerWindow then return false end

    local list = playerPermits[source] or {}
    playerPermits[source] = list
    prune(list, now)
    list[#list + 1] = { kind = kind, resource = resource, expiresAt = now + ttl }
    if Config.debugLog then
        Logger.structured('info', 'permit_granted', { source = source, kind = kind, resource = resource })
    end
    return true
end

---@param kind string
---@param resource string
---@return boolean
function M.grantServer(kind, resource)
    local ttl = Config.serverTtlMs[kind]
    if not ttl or not validResource(resource) then return false end
    local now = GetGameTimer()
    prune(serverPermits, now)
    if #serverPermits >= 256 then return false end
    serverPermits[#serverPermits + 1] = { kind = kind, resource = resource, expiresAt = now + ttl }
    if Config.debugLog then
        Logger.structured('info', 'permit_granted', { source = 0, kind = kind, resource = resource })
    end
    return true
end

---Uses one announcement for this player, falling back to one made by a server script.
---@param source number
---@param kind string
---@return boolean
function M.consume(source, kind)
    local list = playerPermits[source]
    if list and take(list, kind) then return true end
    return take(serverPermits, kind)
end

---@param source number
---@param rule string
---@param measured table<string, any>
---@return DetectionDecision?
function M.violation(source, rule, measured)
    if GetPlayerName(source) == nil then return nil end
    if not Config.enforce then
        measured.rule = rule
        measured.source = source
        Logger.structured('warn', 'permit_violation_not_enforced', measured)
        return nil
    end
    return Engine.submit({ rule = rule, source = source, measured = measured })
end

function M.start()
    RegisterNetEvent('simpleac:permit', function(kind, resource)
        if type(kind) ~= 'string' then return end
        M.grant(source, kind, resource)
    end)

    exports('Permit', function(kind)
        local resource = GetInvokingResource()
        if type(kind) ~= 'string' or type(resource) ~= 'string' or resource == GetCurrentResourceName() then
            return false
        end
        return M.grantServer(kind, resource)
    end)

    AddEventHandler('playerDropped', function()
        playerPermits[source] = nil
        rates[source] = nil
    end)
end

return M
