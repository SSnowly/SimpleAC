local Config = require 'configs.server.grace'
local M = {}

---@class GraceWindow
---@field expiresAt number
---@field categories table<string, boolean>

---@type table<number, table<string, GraceWindow>>
local windows = {}
---@type table<number, table<string, number>>
local lastGrant = {}

---@param categories string[]
---@return table<string, boolean>
local function toSet(categories)
    local set = {}
    for index = 1, #categories do set[categories[index]] = true end
    return set
end

---@param source number
---@param kind string
---@param durationMs number
---@param categories string[]
local function open(source, kind, durationMs, categories)
    windows[source] = windows[source] or {}
    windows[source][kind] = {
        expiresAt = GetGameTimer() + math.min(durationMs, Config.maximumDurationMs),
        categories = toSet(categories),
    }
end

---@param source number
function M.grantJoin(source)
    local join = Config.join
    windows[source] = windows[source] or {}
    windows[source].join = { expiresAt = GetGameTimer() + join.durationMs, categories = toSet(join.categories) }
end

---Grants a window requested by the client. Returns false when the kind is unknown or on cooldown.
---@param source number
---@param kind string
---@return boolean
function M.grantHint(source, kind)
    local definition = type(kind) == 'string' and Config.hints[kind] or nil
    if not definition then return false end

    local now = GetGameTimer()
    lastGrant[source] = lastGrant[source] or {}
    local previous = lastGrant[source][kind]
    if previous and now - previous < definition.cooldownMs then return false end

    if definition.requiresAlive then
        local ped = GetPlayerPed(source)
        if not ped or ped == 0 or GetEntityHealth(ped) <= 0 then return false end
    end

    lastGrant[source][kind] = now
    open(source, kind, definition.durationMs, definition.categories)
    return true
end

---@param source number
---@param category string
---@return boolean
function M.covers(source, category)
    local sourceWindows = windows[source]
    if not sourceWindows then return false end

    local now = GetGameTimer()
    for kind, window in pairs(sourceWindows) do
        if window.expiresAt <= now then
            sourceWindows[kind] = nil
        elseif window.categories[category] then
            return true
        end
    end
    return false
end

---@param source number
function M.clear(source)
    windows[source] = nil
    lastGrant[source] = nil
end

AddEventHandler('playerDropped', function() M.clear(source) end)

return M
