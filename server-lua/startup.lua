local Config = require 'configs.server.main'
local Logger = require 'server-lua.logger'
local M = {}

---@return boolean, string[]
function M.checkDependencies()
    local failures = {}

    for index = 1, #Config.requiredResources do
        local resourceName = Config.requiredResources[index]
        local state = GetResourceState(resourceName)

        if state ~= 'started' and state ~= 'starting' then
            failures[#failures + 1] = ('%s is %s'):format(resourceName, state)
        end
    end

    if GetConvar('onesync', 'off') == 'off' then
        failures[#failures + 1] = 'OneSync is disabled'
    end

    if #failures > 0 then
        Logger.structured('error', 'startup_check_failed', { failures = failures })
        return false, failures
    end

    Logger.structured('info', 'startup_check_passed')
    return true, failures
end

return M
