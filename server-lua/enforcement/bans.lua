local DryRun = require 'server-lua.enforcement.dry_run'
local Sessions = require 'server-lua.services.sessions'
local M = {}

function M.start()
    ---Called by the TypeScript control plane after it persists a ban through the HTTP API.
    ---@param playerId string
    ---@param banId string
    ---@return boolean dropped
    exports('InternalEnforceBan', function(playerId, banId)
        if GetInvokingResource() ~= GetCurrentResourceName() then return false end
        if type(playerId) ~= 'string' or type(banId) ~= 'string' then return false end

        local source = Sessions.findSource(playerId)
        if not source then return false end

        if DryRun.active() then
            DryRun.skipped('kick', { source = source, banId = banId })
            return false
        end

        DropPlayer(source, locale('kick.banned', banId))
        return true
    end)
end

return M
