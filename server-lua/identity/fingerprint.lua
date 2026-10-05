local Config = require 'configs.server.evasion'
local Evasion = require 'server-lua.identity.evasion'
local Id = require 'server-lua.id'
local Logger = require 'server-lua.logger'
local Sessions = require 'server-lua.services.sessions'
local M = {}

local STRING_LIMITS = {
    userAgent = 300,
    platform = 64,
    locale = 32,
    timezone = 64,
    webglVendor = 128,
    webglRenderer = 256,
    webglSignature = 128,
    canvasSignature = 128,
    audioSignature = 128,
    storageId = 64,
}

local NUMBER_RANGES = {
    screenWidth = { 0, 20000 },
    screenHeight = { 0, 20000 },
    colorDepth = { 0, 64 },
    pixelRatio = { 0, 16 },
    hardwareConcurrency = { 0, 512 },
    deviceMemory = { 0, 1024 },
}

-- Left out of the composite fingerprint: the storage id is per browser profile and the audio signature is
-- optional, so neither should split an otherwise identical device in two.
local COMPOSITE_EXCLUDED = { storageId = true, audioSignature = true }
local MINIMUM_ATTRIBUTES = 4
local TOKEN_PATTERN = '^%x+$'

---@type table<number, number>
local submissions = {}

---Validates and normalizes a client payload. Unknown keys are dropped, strings are trimmed, lowercased and
---length limited, numbers are clamped. Returns nil when too little usable data remains.
---@param raw any
---@return table<string, string>?
function M.normalize(raw)
    if type(raw) ~= 'table' then return nil end
    local attributes, count = {}, 0

    for name, limit in pairs(STRING_LIMITS) do
        local value = raw[name]
        if type(value) == 'string' then
            value = value:gsub('%c', ''):match('^%s*(.-)%s*$'):lower():sub(1, limit)
            if value ~= '' then
                attributes[name] = value
                count = count + 1
            end
        end
    end

    for name, range in pairs(NUMBER_RANGES) do
        local value = tonumber(raw[name])
        if value and value == value and value ~= math.huge and value ~= -math.huge then
            value = math.max(range[1], math.min(range[2], value))
            attributes[name] = name == 'pixelRatio' and ('%.2f'):format(value) or ('%d'):format(math.floor(value))
            count = count + 1
        end
    end

    if count < MINIMUM_ATTRIBUTES then return nil end
    return attributes
end

---@param attributes table<string, string>
---@return string
function M.compositeInput(attributes)
    local names = {}
    for name in pairs(attributes) do
        if not COMPOSITE_EXCLUDED[name] then names[#names + 1] = name end
    end
    table.sort(names)

    local parts = {}
    for index = 1, #names do parts[index] = ('%s=%s'):format(names[index], attributes[names[index]]) end
    return table.concat(parts, ';')
end

---Hashes strings with the per-server salt so stored values cannot be reversed or compared across servers.
---@param values string[]
---@return string[]?
local function hashValues(values)
    local selects = {}
    for index = 1, #values do
        selects[index] = ('LOWER(SHA2(CONCAT(HEX(identifier_salt), ?), 256)) AS h%d'):format(index)
    end

    local row = MySQL.single.await(('SELECT %s FROM sac_server_installation LIMIT 1'):format(table.concat(selects, ', ')),
        values)
    if not row then return nil end

    local hashes = {}
    for index = 1, #values do hashes[index] = row[('h%d'):format(index)] end
    return hashes
end

---@param payload any
---@return string[]
local function validTokens(payload)
    local tokens = {}
    if type(payload) ~= 'table' then return tokens end
    for index = 1, math.min(#payload, 2) do
        local token = payload[index]
        if type(token) == 'string' and #token == 64 and token:match(TOKEN_PATTERN) then tokens[#tokens + 1] = token:lower() end
    end
    return tokens
end

---@param compositeHash string
---@return string
local function upsertFingerprint(compositeHash)
    local version = Config.algorithmVersion
    local lookup = 'SELECT id FROM sac_fingerprints WHERE algorithm_version = ? AND fingerprint_hash = ?'
    local existing = MySQL.scalar.await(lookup, { version, compositeHash })
    if existing then
        MySQL.update.await('UPDATE sac_fingerprints SET last_seen_at = CURRENT_TIMESTAMP(3) WHERE id = ?', { existing })
        return existing
    end

    MySQL.insert.await(
        'INSERT IGNORE INTO sac_fingerprints (id, algorithm_version, fingerprint_hash) VALUES (?, ?, ?)',
        { Id.create('SAC-FP'), version, compositeHash })
    return MySQL.scalar.await(lookup, { version, compositeHash })
end

---Registers the player against every presented token that this server issued. When none is known a new token
---is issued and its raw value is returned for the client to store.
---@param playerId string
---@param tokens string[]
---@return string[] tokenHashes
---@return string? issued
local function resolveTokens(playerId, tokens)
    local known = {}
    if #tokens > 0 then
        local values = {}
        for index = 1, #tokens do values[index] = 'token:' .. tokens[index] end
        for _, hash in ipairs(hashValues(values) or {}) do
            if MySQL.scalar.await('SELECT 1 FROM sac_device_tokens WHERE token_hash = ?', { hash }) then
                known[#known + 1] = hash
            end
        end
    end

    local issued
    if #known == 0 then
        issued = MySQL.scalar.await('SELECT LOWER(HEX(RANDOM_BYTES(32)))')
        local hashed = type(issued) == 'string' and hashValues({ 'token:' .. issued }) or nil
        if not hashed then return known, nil end
        MySQL.insert.await('INSERT IGNORE INTO sac_device_tokens (token_hash) VALUES (?)', { hashed[1] })
        known[1] = hashed[1]
    end

    for index = 1, #known do
        MySQL.insert.await([[INSERT INTO sac_device_token_players (token_hash, player_id) VALUES (?, ?)
            ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP(3)]], { known[index], playerId })
    end
    return known, issued
end

---@param source number
---@return ActiveSession?
local function waitForSession(source)
    for _ = 1, 40 do
        local session = Sessions.getActive(source)
        if session then return session end
        Wait(250)
    end
    return nil
end

---@param source number
---@param payload any
local function process(source, payload)
    if type(payload) ~= 'table' then return end
    local attributes = M.normalize(payload.attributes)
    if not attributes then return end

    local session = waitForSession(source)
    if not session then return end

    local names, values = {}, {}
    for name in pairs(attributes) do names[#names + 1] = name end
    table.sort(names)
    for index = 1, #names do
        values[index] = ('attr:%s=%s'):format(names[index], attributes[names[index]])
    end
    values[#values + 1] = ('v%d:%s'):format(Config.algorithmVersion, M.compositeInput(attributes))

    local hashed = hashValues(values)
    if not hashed then return end
    local hashes = {}
    for index = 1, #names do hashes[names[index]] = hashed[index] end

    local fingerprintId = upsertFingerprint(hashed[#hashed])
    MySQL.insert.await([[INSERT INTO sac_fingerprint_observations (fingerprint_id, player_id, session_id, attributes_json)
        VALUES (?, ?, ?, ?)]], { fingerprintId, session.playerId, session.sessionId, json.encode(hashes) })

    local tokenHashes, issued = resolveTokens(session.playerId, validTokens(payload.tokens))
    TriggerClientEvent('simpleac:fingerprint:ack', source, issued or false)

    local ipHash = MySQL.scalar.await('SELECT endpoint_hash FROM sac_player_sessions WHERE id = ?', { session.sessionId })
    Evasion.evaluate(source, session.playerId, {
        fingerprintId = fingerprintId,
        hashes = hashes,
        tokenHashes = tokenHashes,
        ipHash = type(ipHash) == 'string' and ipHash or '',
    })
end

function M.start()
    if not Config.enabled then return end

    RegisterNetEvent('simpleac:fingerprint:submit', function(payload)
        local playerSource = source
        if type(playerSource) ~= 'number' or playerSource <= 0 then return end
        local count = (submissions[playerSource] or 0) + 1
        if count > Config.maximumSubmissions then return end
        submissions[playerSource] = count

        CreateThread(function()
            local ok, err = xpcall(process, debug.traceback, playerSource, payload)
            if not ok then Logger.structured('error', 'fingerprint_failed', { source = playerSource, error = err }) end
        end)
    end)

    AddEventHandler('playerDropped', function() submissions[source] = nil end)
end

return M
