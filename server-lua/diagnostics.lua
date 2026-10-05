local Bridge = require 'bridge._index'
local Config = require 'configs.shared.main'
local M = {}

---@return table<string, any>
function M.snapshot()
    local migrationVersion = MySQL.scalar.await('SELECT MAX(version) FROM sac_schema_migrations')
    local playerCount = MySQL.scalar.await('SELECT COUNT(*) FROM sac_players') or 0
    local actionCount = MySQL.scalar.await('SELECT COUNT(*) FROM sac_actions') or 0
    local activeSessionCount = MySQL.scalar.await([[
        SELECT COUNT(*) FROM sac_player_sessions WHERE disconnected_at IS NULL
    ]]) or 0
    local detectionCount = MySQL.scalar.await('SELECT COUNT(*) FROM sac_detections') or 0
    local caseCount = MySQL.scalar.await('SELECT COUNT(*) FROM sac_cases') or 0
    local profileCount = MySQL.scalar.await('SELECT COUNT(*) FROM sac_profiles') or 0
    local registeredRules = 0
    for _ in pairs(require('server-lua.detection.rules').all()) do registeredRules = registeredRules + 1 end

    return {
        resource = GetCurrentResourceName(),
        version = Config.version,
        migrationVersion = migrationVersion or 0,
        records = {
            players = playerCount,
            actions = actionCount,
            activeSessions = activeSessionCount,
            detections = detectionCount,
            cases = caseCount,
            registeredRules = registeredRules,
            profiles = profileCount,
        },
        dependencies = {
            ox_lib = GetResourceState('ox_lib'),
            oxmysql = GetResourceState('oxmysql'),
            onesync = GetConvar('onesync', 'off'),
        },
    }
end

lib.addCommand('simpleac:diagnostics', {
    help = locale('diagnostics.help'),
    restricted = 'simpleac.admin',
}, function(source)
    local snapshot = M.snapshot()
    print(('[SimpleAC] %s'):format(json.encode(snapshot)))

    if source > 0 then
        local identifier = Bridge.identity.getPrimaryIdentifier(source)
        lib.notify(source, {
            title = locale('diagnostics.title'),
            description = identifier and locale('diagnostics.written') or locale('diagnostics.no_identifier'),
            type = identifier and 'success' or 'error',
        })
    end
end)

return M
