local Config = require 'configs.server.protections'
local DryRun = require 'server-lua.enforcement.dry_run'
local Engine = require 'server-lua.detection.engine'
local M = {}

---@class ProtectedEventDefinition
---@field arguments table[]?
---@field limit number?
---@field windowMs number?

---@type table<string, boolean>
local registered = {}
---@type table<string, table<number, { startedAt: number, count: number }>>
local rates = {}

---@param value any
---@param definition table<string, any>
---@return boolean
local function validArgument(value, definition)
    if type(definition.type) ~= 'string' or type(value) ~= definition.type then return false end
    if definition.type == 'string' and (#value > (definition.maxLength or Config.protectedEvents.maximumStringLength)) then
        return false
    end
    if definition.type == 'number' then
        if definition.minimum and value < definition.minimum then return false end
        if definition.maximum and value > definition.maximum then return false end
    end
    return true
end

---@param source number
---@param eventName string
---@param limit number
---@param windowMs number
---@return boolean
local function withinRate(source, eventName, limit, windowMs)
    rates[eventName] = rates[eventName] or {}
    local now = GetGameTimer()
    local state = rates[eventName][source]
    if not state or now - state.startedAt >= windowMs then
        state = { startedAt = now, count = 0 }
        rates[eventName][source] = state
    end
    state.count = state.count + 1
    return state.count <= limit
end

---@param eventName string
---@param definition ProtectedEventDefinition
---@param handler function
---@param resourceName string
---@return boolean
function M.register(eventName, definition, handler, resourceName)
    if type(eventName) ~= 'string' or not eventName:match('^[a-zA-Z0-9:_-]+$') or #eventName > 128 then return false end
    if type(definition) ~= 'table' or type(handler) ~= 'function' or registered[eventName] then return false end
    if type(resourceName) ~= 'string' or resourceName == '' then return false end
    local arguments = definition.arguments or {}
    if #arguments > Config.protectedEvents.maximumArguments then return false end

    registered[eventName] = true
    RegisterNetEvent(eventName)
    AddEventHandler(eventName, function(...)
        local playerSource = source
        if type(playerSource) ~= 'number' or playerSource <= 0 or GetPlayerName(playerSource) == nil then return end
        local values = { ... }
        local reason

        if #values ~= #arguments then
            reason = 'argument_count'
        else
            for index = 1, #arguments do
                if not validArgument(values[index], arguments[index]) then
                    reason = ('argument_%d'):format(index)
                    break
                end
            end
        end

        local limit = math.max(1, math.min(1000, tonumber(definition.limit) or Config.protectedEvents.defaultLimit))
        local windowMs = math.max(100, math.min(60000, tonumber(definition.windowMs) or Config.protectedEvents.defaultWindowMs))
        if not reason and not withinRate(playerSource, eventName, limit, windowMs) then reason = 'rate_limit' end

        if reason then
            Engine.submit({
                rule = 'integration.protected_event',
                source = playerSource,
                resourceName = resourceName,
                measured = { eventName = eventName, reason = reason },
            })
            if DryRun.active() then
                DryRun.skipped('cancel_event', { source = playerSource, event = eventName, reason = reason })
            else
                CancelEvent()
                return
            end
        end

        handler(playerSource, table.unpack(values))
    end)
    return true
end

return M
