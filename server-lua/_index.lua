local Config = require 'configs.shared.main'
local Logger = require 'server-lua.logger'
local Startup = require 'server-lua.startup'
local Migrations = require 'server-lua.migrations.runner'

CreateThread(function()
    local dependenciesReady = Startup.checkDependencies()
    if not dependenciesReady then
        TriggerEvent('simpleac:internal:startupFailed', 'dependency_check_failed')
        return
    end

    local ok, migrationVersion = xpcall(Migrations.run, debug.traceback)
    if not ok then
        Logger.structured('error', 'migration_failed', { error = migrationVersion })
        TriggerEvent('simpleac:internal:startupFailed', 'migration_failed')
        return
    end

    require 'server-lua.diagnostics'
    require('server-lua.detection.profile').start()
    require('server-lua.detection.exceptions').reload()
    require('server-lua.services.sessions').start()
    require('server-lua.protections.network').start()
    require('server-lua.protections.combat').start()
    require('server-lua.protections.vehicle').start()
    require('server-lua.integrity.heartbeat').start()
    require('server-lua.enforcement.bans').start()
    require('server-lua.identity.fingerprint').start()
    require('server-lua.evidence.capture').start()
    require('server-lua.evidence.ocr').start()
    require('server-lua.detection.client_reports').start()
    require('server-lua.detection.exports').start()
    require('server-lua.panel').start()
    Logger.structured('info', 'resource_ready', {
        version = Config.version,
        migrationVersion = migrationVersion,
    })
    TriggerEvent('simpleac:internal:ready', migrationVersion)
end)
