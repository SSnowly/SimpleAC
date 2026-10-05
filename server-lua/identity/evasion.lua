local Actions = require 'server-lua.repositories.actions'
local Config = require 'configs.server.evasion'
local DryRun = require 'server-lua.enforcement.dry_run'
local Engine = require 'server-lua.detection.engine'
local M = {}

---Attribute groups that are scored as one signal; every attribute of a group must match.
local ATTRIBUTE_GROUPS = {
    canvas = { 'canvasSignature' },
    webglSignature = { 'webglSignature' },
    audio = { 'audioSignature' },
    webglRenderer = { 'webglRenderer' },
    screen = { 'screenWidth', 'screenHeight', 'colorDepth', 'pixelRatio' },
    userAgent = { 'userAgent' },
    timezone = { 'timezone' },
    locale = { 'locale' },
    hardware = { 'hardwareConcurrency', 'deviceMemory' },
}

-- Attributes that are cheap to query on (JSON lookups); everything else only scores once a candidate is found.
local LOOKUP_ATTRIBUTES = { 'storageId', 'canvasSignature', 'webglSignature', 'audioSignature' }

---@class EvasionSignal
---@field signal string
---@field weight number

---@class EvasionCurrent
---@field hashes table<string, string> hashed attribute values
---@field fingerprintId string

---@class EvasionCandidate
---@field hashes table<string, string>
---@field fingerprintId string?
---@field sharedToken boolean
---@field sharedIp boolean

---@param current table<string, string>
---@param candidate table<string, string>
---@param names string[]
---@return boolean
local function groupMatches(current, candidate, names)
    for index = 1, #names do
        local name = names[index]
        if not current[name] or current[name] ~= candidate[name] then return false end
    end
    return true
end

---@param current EvasionCurrent
---@param candidate EvasionCandidate
---@return number score 0-100
---@return EvasionSignal[] signals every contributing signal with its weight
function M.score(current, candidate)
    local weights = Config.weights
    local signals = {}
    local total = 0

    local function add(signal, weight)
        signals[#signals + 1] = { signal = signal, weight = weight }
        total = total + weight
    end

    if candidate.sharedToken then add('deviceToken', weights.deviceToken) end
    local storageId = current.hashes.storageId
    if storageId and storageId == candidate.hashes.storageId then add('storageId', weights.storageId) end

    if candidate.fingerprintId and candidate.fingerprintId == current.fingerprintId then
        add('fingerprintExact', weights.fingerprintExact)
    else
        local matched, sum = {}, 0
        local groups = {}
        for group in pairs(ATTRIBUTE_GROUPS) do groups[#groups + 1] = group end
        table.sort(groups)
        for _, group in ipairs(groups) do
            local weight = weights.attributes[group]
            if weight and groupMatches(current.hashes, candidate.hashes, ATTRIBUTE_GROUPS[group]) then
                matched[#matched + 1] = group
                sum = sum + weight
            end
        end
        if sum > 0 then add(('attributes(%s)'):format(table.concat(matched, ',')), math.min(sum, weights.attributeCap)) end
    end

    if candidate.sharedIp then add('ip', weights.ip) end
    return math.min(100, total), signals
end

---@param score number
---@return 'review' | 'restrict' | 'block' | nil
function M.outcomeFor(score)
    local outcomes = Config.outcomes
    if outcomes.block and score >= outcomes.block then return 'block' end
    if outcomes.restrict and score >= outcomes.restrict then return 'restrict' end
    if outcomes.review and score >= outcomes.review then return 'review' end
    return nil
end

---@param signals EvasionSignal[]
---@return string
function M.describe(signals)
    local parts = {}
    for index = 1, #signals do parts[index] = ('%s:%d'):format(signals[index].signal, signals[index].weight) end
    return table.concat(parts, ';')
end

---@class EvasionContext
---@field fingerprintId string
---@field hashes table<string, string>
---@field tokenHashes string[]
---@field ipHash string

---@param playerId string
---@param context EvasionContext
---@return table<string, EvasionCandidate>
local function gatherCandidates(playerId, context)
    local limit = Config.candidateLimit
    ---@type table<string, EvasionCandidate>
    local candidates = {}

    local function candidate(id)
        candidates[id] = candidates[id] or { hashes = {}, sharedToken = false, sharedIp = false }
        return candidates[id]
    end

    for index = 1, #context.tokenHashes do
        local rows = MySQL.query.await(
            'SELECT player_id FROM sac_device_token_players WHERE token_hash = ? AND player_id <> ? LIMIT ?',
            { context.tokenHashes[index], playerId, limit })
        for row = 1, #rows do candidate(rows[row].player_id).sharedToken = true end
    end

    if context.ipHash ~= '' then
        local rows = MySQL.query.await([[SELECT DISTINCT player_id FROM sac_player_identifiers
            WHERE identifier_type = 'ip' AND identifier_key = ? AND player_id <> ? LIMIT ?]],
            { context.ipHash, playerId, limit })
        for row = 1, #rows do candidate(rows[row].player_id).sharedIp = true end
    end

    local conditions, values = { 'fingerprint_id = ?' }, { context.fingerprintId }
    for _, name in ipairs(LOOKUP_ATTRIBUTES) do
        if context.hashes[name] then
            conditions[#conditions + 1] = ("JSON_UNQUOTE(JSON_EXTRACT(attributes_json, '$.%s')) = ?"):format(name)
            values[#values + 1] = context.hashes[name]
        end
    end
    values[#values + 1] = playerId
    values[#values + 1] = limit
    local rows = MySQL.query.await(([[SELECT DISTINCT player_id FROM sac_fingerprint_observations
        WHERE (%s) AND player_id <> ? ORDER BY observed_at DESC LIMIT ?]]):format(table.concat(conditions, ' OR ')),
        values)
    for row = 1, #rows do candidate(rows[row].player_id) end

    for id, entry in pairs(candidates) do
        local latest = MySQL.single.await([[SELECT fingerprint_id, attributes_json FROM sac_fingerprint_observations
            WHERE player_id = ? ORDER BY observed_at DESC LIMIT 1]], { id })
        if latest then
            entry.fingerprintId = latest.fingerprint_id
            local decoded = type(latest.attributes_json) == 'string' and json.decode(latest.attributes_json) or nil
            if type(decoded) == 'table' then entry.hashes = decoded end
        end
    end

    return candidates
end

---@param playerId string
---@return string?
local function activeBan(playerId)
    return MySQL.scalar.await([[SELECT id FROM sac_bans WHERE player_id = ? AND revoked_by_action_id IS NULL
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3)) LIMIT 1]], { playerId })
end

---@param source number
---@param playerId string
---@param context EvasionContext
function M.evaluate(source, playerId, context)
    local current = { hashes = context.hashes, fingerprintId = context.fingerprintId }
    local best

    for targetId, entry in pairs(gatherCandidates(playerId, context)) do
        local score, signals = M.score(current, entry)
        if score >= Config.minimumLinkScore then
            -- One row per pair regardless of which identity was seen second.
            local low, high = playerId, targetId
            if high < low then low, high = high, low end
            MySQL.insert.await([[INSERT INTO sac_identity_links (source_player_id, target_player_id, score, reasons_json)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE score = VALUES(score), reasons_json = VALUES(reasons_json)]],
                { low, high, score, json.encode(signals) })

            local banId = activeBan(targetId)
            if banId and (not best or score > best.score) then
                best = { score = score, signals = signals, targetId = targetId, banId = banId }
            end
        end
    end

    local outcome = best and M.outcomeFor(best.score)
    if not outcome or not best then return end

    local description = M.describe(best.signals)
    Engine.submit({
        rule = 'identity.ban_evasion',
        source = source,
        measured = {
            score = best.score,
            outcome = outcome,
            targetPlayerId = best.targetId,
            banId = best.banId,
            signals = description,
        },
    })

    if outcome == 'review' then return end
    if DryRun.active() then
        DryRun.skipped(outcome, { source = source, targetPlayerId = best.targetId, score = best.score })
        return
    end

    Actions.create({
        actorType = 'system',
        actionType = outcome == 'block' and 'identity.evasion.blocked' or 'identity.evasion.restricted',
        targetType = 'player',
        targetId = playerId,
        reason = ('Linked to banned identity %s'):format(best.targetId),
        metadata = { banId = best.banId, score = best.score, signals = description },
        origin = 'fingerprint',
    })
    if outcome == 'restrict' then
        Player(source).state:set('simpleacRestricted', true, true)
    else
        DropPlayer(source, locale('kick.evasion', best.banId))
    end
end

return M
