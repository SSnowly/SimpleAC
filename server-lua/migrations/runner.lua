local Config = require 'configs.server.main'
local Logger = require 'server-lua.logger'
local migrations = {
    require 'server-lua.migrations.001_initial',
    require 'server-lua.migrations.002_identity_ledger',
    require 'server-lua.migrations.003_detection_engine',
    require 'server-lua.migrations.004_api_security',
    require 'server-lua.migrations.005_fingerprinting',
    require 'server-lua.migrations.006_captures',
    require 'server-lua.migrations.007_panel',
}
local M = {}

---@param migration { version: number, name: string, statements: string[] }
local function applyMigration(migration)
    for index = 1, #migration.statements do
        MySQL.query.await(migration.statements[index])
    end

    MySQL.insert.await(
        'INSERT INTO sac_schema_migrations (version, name) VALUES (?, ?)',
        { migration.version, migration.name }
    )
end

local LEASE_SECONDS = 120

---oxmysql serves queries from a connection pool, so session-scoped GET_LOCK()/RELEASE_LOCK() can run on
---different connections and leave the lock held. A leased row works across connections and survives a crash.
---@return string owner
local function acquireLock()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS sac_migration_lock (
            name VARCHAR(64) PRIMARY KEY,
            owner VARCHAR(64) NOT NULL,
            expires_at TIMESTAMP(3) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ]])

    local owner = ('%d-%d'):format(GetGameTimer(), math.random(1, 2 ^ 30))
    local deadline = GetGameTimer() + Config.migrationLockTimeoutSeconds * 1000
    repeat
        MySQL.update.await('DELETE FROM sac_migration_lock WHERE name = ? AND expires_at < CURRENT_TIMESTAMP(3)',
            { Config.migrationLockName })
        local inserted = MySQL.update.await(
            'INSERT IGNORE INTO sac_migration_lock (name, owner, expires_at) VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND))',
            { Config.migrationLockName, owner, LEASE_SECONDS })
        if inserted == 1 then return owner end
        Wait(500)
    until GetGameTimer() >= deadline

    error('timed out acquiring the database migration lock')
end

---@param owner string
local function releaseLock(owner)
    MySQL.update.await('DELETE FROM sac_migration_lock WHERE name = ? AND owner = ?',
        { Config.migrationLockName, owner })
end

---@return number
function M.run()
    MySQL.query.await([[
        CREATE TABLE IF NOT EXISTS sac_schema_migrations (
            version INT UNSIGNED PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ]])

    local owner = acquireLock()

    local ok, result = xpcall(function()
        local currentVersion = tonumber(MySQL.scalar.await('SELECT MAX(version) FROM sac_schema_migrations')) or 0

        for index = 1, #migrations do
            local migration = migrations[index]
            if migration.version > currentVersion then
                Logger.structured('info', 'migration_started', {
                    version = migration.version,
                    name = migration.name,
                })
                applyMigration(migration)
                currentVersion = migration.version
                Logger.structured('info', 'migration_completed', {
                    version = migration.version,
                    name = migration.name,
                })
            end
        end

        return currentVersion
    end, debug.traceback)

    releaseLock(owner)
    if not ok then error(result) end

    return result
end

return M
