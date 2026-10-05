local Config = require 'configs.shared.main'
local Logger = require 'server-lua.logger'
local M = {}

---While the `simpleac:debug` convar is 1 nothing is enforced: bans do not block connections, nobody is
---kicked or restricted and events are not cancelled. Each skipped action is printed to the console instead.
---@return boolean
function M.active()
    return Config.debug
end

---@param action string what would have happened
---@param fields table<string, any>?
function M.skipped(action, fields)
    local payload = fields or {}
    payload.action = action
    Logger.structured('warn', 'debug_action_skipped', payload)
end

return M
