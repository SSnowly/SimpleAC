local Config = require 'configs.shared.main'
local M = {}

---@param source number
---@param event string
---@param message string
function M.event(source, event, message)
    if not Config.logging then return end
    if type(source) ~= 'number' or type(event) ~= 'string' or type(message) ~= 'string' then return end

    lib.logger(source, event, message)
end

---@param level 'info' | 'warn' | 'error'
---@param event string
---@param fields table<string, any>?
function M.structured(level, event, fields)
    local payload = {
        level = level,
        event = event,
        resource = GetCurrentResourceName(),
        timestamp = os.date('!%Y-%m-%dT%H:%M:%SZ'),
        fields = fields or {},
    }

    print(('[SimpleAC] %s'):format(json.encode(payload)))
end

return M
