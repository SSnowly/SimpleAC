local Config = require 'configs.server.profile'
local Id = require 'server-lua.id'
local M = {}
local activeProfileId
local activeVersionId

function M.start()
    local row = MySQL.single.await([[
        SELECT p.id, p.active_version_id
        FROM sac_profiles p
        WHERE p.name = ?
        LIMIT 1
    ]], { Config.name })

    if row then
        activeProfileId = row.id
        activeVersionId = row.active_version_id
        return
    end

    activeProfileId = Id.create('SAC-PRF')
    activeVersionId = Id.create('SAC-PRF')
    local committed = MySQL.transaction.await({
        {
            query = [[INSERT INTO sac_profiles (id, name, description, active_version_id)
                VALUES (?, ?, ?, ?)]],
            values = { activeProfileId, Config.name, 'Default conservative roleplay profile', activeVersionId },
        },
        {
            query = [[INSERT INTO sac_profile_versions (id, profile_id, version, config_json, created_by)
                VALUES (?, ?, ?, ?, ?)]],
            values = { activeVersionId, activeProfileId, Config.version, json.encode(Config), 'system' },
        },
    })

    if not committed then error('failed to seed the balanced profile') end
end

---@param ruleKey string
---@return table<string, any>?
function M.rule(ruleKey)
    return Config.rules[ruleKey]
end

---@return table<string, any>
function M.get()
    return Config
end

---@return string?
function M.versionId()
    return activeVersionId
end

return M
