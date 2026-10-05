local Actions = require 'server-lua.repositories.actions'
local Allowances = require 'server-lua.detection.allowances'
local Capture = require 'server-lua.evidence.capture'
local Context = require 'server-lua.detection.context'
local DryRun = require 'server-lua.enforcement.dry_run'
local Exceptions = require 'server-lua.detection.exceptions'
local Grace = require 'server-lua.detection.grace'
local Id = require 'server-lua.id'
local Logger = require 'server-lua.logger'
local Profile = require 'server-lua.detection.profile'
local Registry = require 'server-lua.detection.rules'
local Sessions = require 'server-lua.services.sessions'
local M = {}

---@class DetectionSignal
---@field rule string
---@field source number
---@field measured table<string, any>
---@field resourceName string?

---@class DetectionDecision
---@field accepted boolean
---@field reason string
---@field detectionId string?
---@field playerId string?
---@field sessionId string?
---@field rule DetectionRule?
---@field severity number?
---@field confidence number?
---@field score number?
---@field cumulativeRisk number?
---@field cancel boolean
---@field outcome string?
---@field announce boolean?
---@field wouldHave string? outcome that debug mode downgraded to log
---@field measured table<string, any>?

---@type table<number, table<string, { count: number, lastAt: number }>>
local strikes = {}
---@type table<number, { time: number, category: string, score: number }[]>
local history = {}
---@type table<number, table<string, number>>
local cooldowns = {}

---@param measured table<string, any>
---@return table<string, string | number | boolean>?
local function normalizeMeasured(measured)
    local normalized = {}
    local count = 0

    for key, value in pairs(measured) do
        count = count + 1
        if count > 32 or type(key) ~= 'string' or #key > 64 then return nil end

        local valueType = type(value)
        if valueType == 'string' then
            if #value > 512 then return nil end
            normalized[key] = value
        elseif valueType == 'number' then
            if value ~= value or value == math.huge or value == -math.huge then return nil end
            normalized[key] = value
        elseif valueType == 'boolean' then
            normalized[key] = value
        else
            return nil
        end
    end

    return normalized
end

---@param source number
---@param rule DetectionRule
---@param score number
---@return number
local function correlate(source, rule, score)
    local now = GetGameTimer()
    local profile = Profile.get()
    local entries = history[source] or {}
    local retained = {}
    local cumulative = score
    local categories = { [rule.category] = true }

    for index = 1, #entries do
        local entry = entries[index]
        if now - entry.time <= profile.correlationWindowMs then
            retained[#retained + 1] = entry
            cumulative = cumulative + entry.score * 0.35
            categories[entry.category] = true
        end
    end

    retained[#retained + 1] = { time = now, category = rule.category, score = score }
    history[source] = retained

    local categoryCount = 0
    for _ in pairs(categories) do categoryCount = categoryCount + 1 end
    if categoryCount > 1 then cumulative = cumulative + (categoryCount - 1) * 20 end

    return cumulative
end

---@param source number
---@param rule DetectionRule
---@return number
local function updateStrikes(source, rule)
    local now = GetGameTimer()
    strikes[source] = strikes[source] or {}
    local state = strikes[source][rule.key] or { count = 0, lastAt = now }
    local elapsed = now - state.lastAt

    if elapsed > rule.strikeWindowMs then
        state.count = 0
    elseif rule.strikeDecayMs > 0 then
        state.count = math.max(0, state.count - math.floor(elapsed / rule.strikeDecayMs))
    end

    state.count = state.count + 1
    state.lastAt = now
    strikes[source][rule.key] = state
    return state.count
end

---@param cumulativeRisk number
---@param mode string
---@return string
local function chooseOutcome(cumulativeRisk, mode)
    if mode == 'log' then return 'log' end
    if mode == 'temporary_ban' or mode == 'permanent_ban' then return mode end
    local thresholds = Profile.get().enforcement
    if cumulativeRisk >= thresholds.permanentBan then return 'permanent_ban' end
    if cumulativeRisk >= thresholds.temporaryBan then return 'temporary_ban' end
    if cumulativeRisk >= thresholds.kick then return 'kick' end
    if cumulativeRisk >= thresholds.restrict then return 'restrict' end
    if cumulativeRisk >= thresholds.warn then return 'warn' end
    return mode == 'cancel' and 'cancel' or 'log'
end

---@param signal DetectionSignal
---@return DetectionDecision
function M.evaluate(signal)
    if type(signal) ~= 'table' or type(signal.rule) ~= 'string' or type(signal.source) ~= 'number' then
        return { accepted = false, reason = 'invalid_signal', cancel = false }
    end

    local rule = Registry.get(signal.rule)
    local session = Sessions.getActive(signal.source)
    if not rule then return { accepted = false, reason = 'unknown_rule', cancel = false } end
    if not session or GetPlayerName(signal.source) == nil then
        return { accepted = false, reason = 'invalid_source', cancel = false }
    end
    if type(signal.measured) ~= 'table' then
        return { accepted = false, reason = 'invalid_measurement', cancel = false }
    end
    local measured = normalizeMeasured(signal.measured)
    if not measured then return { accepted = false, reason = 'invalid_measurement', cancel = false } end

    local policy = Profile.rule(rule.key)
    if not policy or policy.enabled ~= true then
        return { accepted = false, reason = 'rule_disabled', cancel = false }
    end
    if not rule.validate(measured, { source = signal.source, playerId = session.playerId }) then
        return { accepted = false, reason = 'not_detected', cancel = false }
    end

    local exception = Exceptions.find(session.playerId, rule.key, signal.resourceName)
    if exception then return { accepted = false, reason = 'excepted', cancel = false } end
    if Allowances.isAllowed(signal.source, rule.key, signal.resourceName) then
        return { accepted = false, reason = 'allowed', cancel = false }
    end

    if rule.clientSourced then
        if Grace.covers(signal.source, rule.category) then
            return { accepted = false, reason = 'grace', cancel = false }
        end
        if Context.inSafeZone(signal.source, rule.category) then
            return { accepted = false, reason = 'safe_zone', cancel = false }
        end
    end

    local now = GetGameTimer()
    cooldowns[signal.source] = cooldowns[signal.source] or {}
    local lastAccepted = cooldowns[signal.source][rule.key] or -rule.cooldownMs
    if now - lastAccepted < rule.cooldownMs then
        return { accepted = false, reason = 'cooldown', cancel = policy.mode == 'cancel' and rule.cancellable and not DryRun.active() }
    end
    cooldowns[signal.source][rule.key] = now

    local strikeCount = updateStrikes(signal.source, rule)
    local severity = rule.defaultSeverity
    local confidence = rule.defaultConfidence
    local score = severity * confidence * policy.severityMultiplier + math.min(strikeCount - 1, 5) * 10
    local cumulativeRisk = correlate(signal.source, rule, score)
    local outcome = chooseOutcome(cumulativeRisk, policy.mode)
    -- A profile entry's announce overrides the rule's own default, so any rule can be printed from config.
    local announce = policy.announce
    if announce == nil then announce = rule.announce end
    local cancel = policy.mode == 'cancel' and rule.cancellable and confidence >= policy.minimumConfidence
    local wouldHave
    if DryRun.active() then
        -- Debug mode never acts: keep the decision for the console and the database, drop the enforcement.
        if outcome ~= 'log' then wouldHave = outcome elseif cancel then wouldHave = 'cancel' end
        outcome, cancel, announce = 'log', false, true
    end

    return {
        accepted = true,
        reason = 'detected',
        detectionId = Id.create('SAC-DET'),
        playerId = session.playerId,
        sessionId = session.sessionId,
        rule = rule,
        severity = severity,
        confidence = confidence,
        score = score,
        cumulativeRisk = cumulativeRisk,
        cancel = cancel,
        outcome = outcome,
        announce = announce,
        wouldHave = wouldHave,
        measured = measured,
    }
end

---@param decision DetectionDecision
local function persist(decision)
    if not decision.accepted or not decision.rule then return end

    local profile = Profile.get()
    local caseId
    if decision.cumulativeRisk >= profile.caseThreshold then
        caseId = MySQL.scalar.await([[
            SELECT id FROM sac_cases WHERE player_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1
        ]], { decision.playerId })
        if not caseId then caseId = Id.create('SAC-CASE') end
    end

    local actionType = decision.cancel and 'detection.prevented' or 'detection.recorded'
    if decision.outcome == 'warn' then actionType = 'enforcement.warned' end
    if decision.outcome == 'restrict' then actionType = 'enforcement.restricted' end
    if decision.outcome == 'kick' then actionType = 'enforcement.kicked' end
    if decision.outcome == 'temporary_ban' then actionType = 'enforcement.temporarily_banned' end
    if decision.outcome == 'permanent_ban' then actionType = 'enforcement.permanently_banned' end

    local action = Actions.statement({
        actorType = 'system',
        actionType = actionType,
        targetType = 'player',
        targetId = decision.playerId,
        reason = decision.rule.key,
        metadata = {
            detectionId = decision.detectionId,
            score = decision.score,
            cumulativeRisk = decision.cumulativeRisk,
            outcome = decision.outcome,
            wouldHave = decision.wouldHave,
        },
        origin = 'detection_engine',
    })
    local queries = {
        {
            query = [[INSERT INTO sac_detections (
                id, player_id, session_id, profile_version_id, rule_key, rule_version,
                category, severity, confidence, score, outcome, measured_json, occurred_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))]],
            values = {
                decision.detectionId, decision.playerId, decision.sessionId, Profile.versionId(),
                decision.rule.key, decision.rule.version, decision.rule.category, decision.severity,
                decision.confidence, decision.score, decision.outcome, json.encode(decision.measured),
            },
        },
        { query = action.query, values = action.values },
    }

    if caseId then
        local existing = MySQL.scalar.await('SELECT id FROM sac_cases WHERE id = ?', { caseId })
        if not existing then
            queries[#queries + 1] = {
                query = [[INSERT INTO sac_cases (id, player_id, priority, title) VALUES (?, ?, ?, ?)]],
                values = { caseId, decision.playerId, math.min(100, math.floor(decision.cumulativeRisk)), decision.rule.key },
            }
        end
        queries[#queries + 1] = {
            query = 'INSERT IGNORE INTO sac_case_detections (case_id, detection_id) VALUES (?, ?)',
            values = { caseId, decision.detectionId },
        }
        queries[#queries + 1] = {
            query = [[INSERT INTO sac_case_events (case_id, action_id, event_type, actor, body_json)
                VALUES (?, ?, ?, ?, ?)]],
            values = {
                caseId,
                action.id,
                'detection.linked',
                'system',
                json.encode({ detectionId = decision.detectionId, rule = decision.rule.key }),
            },
        }
    end

    if decision.outcome == 'temporary_ban' or decision.outcome == 'permanent_ban' then
        local banId = Id.create('SAC-BAN')
        if decision.outcome == 'temporary_ban' then
            queries[#queries + 1] = {
                query = [[INSERT INTO sac_bans (id, player_id, action_id, reason, expires_at)
                    VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR))]],
                values = { banId, decision.playerId, action.id, decision.rule.key, profile.temporaryBanHours },
            }
        else
            queries[#queries + 1] = {
                query = [[INSERT INTO sac_bans (id, player_id, action_id, reason, expires_at)
                    VALUES (?, ?, ?, ?, NULL)]],
                values = { banId, decision.playerId, action.id, decision.rule.key },
            }
        end
    end

    if not MySQL.transaction.await(queries) then error('failed to persist detection decision') end

    -- An OCR match names the capture it read; tie that capture to the detection and case so staff find it there.
    local captureId = decision.rule.key == 'evidence.ocr_match' and decision.measured.captureId
    if type(captureId) == 'string' and captureId ~= '' then
        MySQL.update.await([[UPDATE sac_captures
            SET detection_id = COALESCE(detection_id, ?), case_id = COALESCE(case_id, ?)
            WHERE id = ? AND player_id = ?]], { decision.detectionId, caseId, captureId, decision.playerId })
    end

    local source = Sessions.findSource(decision.playerId)
    if decision.announce then
        Logger.structured('warn', 'detection', {
            rule = decision.rule.key,
            source = source,
            player = source and GetPlayerName(source) or nil,
            outcome = decision.outcome,
            checks = decision.measured.checks,
            method = decision.measured.method,
            score = decision.measured.score,
            target = decision.measured.targetPlayerId,
            signals = decision.measured.signals,
            detectionId = decision.detectionId,
        })
    end
    if source then
        -- A screenshot is never part of enforcement: failures here must not affect the decision.
        local ok, err = pcall(Capture.onDetection, source, decision)
        if not ok then Logger.structured('warn', 'capture_trigger_failed', { error = tostring(err) }) end
    end
    if decision.outcome == 'restrict' and source then
        Player(source).state:set('simpleacRestricted', true, true)
    elseif (decision.outcome == 'kick'
        or decision.outcome == 'temporary_ban'
        or decision.outcome == 'permanent_ban') and source then
        DropPlayer(source, locale('kick.detection', decision.rule.key, decision.detectionId))
    end
end

---@param signal DetectionSignal
---@return DetectionDecision
function M.submit(signal)
    local decision = M.evaluate(signal)
    if decision.accepted then CreateThread(function() persist(decision) end) end
    return decision
end

---@param source number
---@return table<string, any>
function M.getRiskState(source)
    local entries = history[source] or {}
    local risk = 0
    for index = 1, #entries do risk = risk + entries[index].score end
    return { source = source, recentSignals = #entries, risk = risk }
end

AddEventHandler('playerDropped', function()
    strikes[source] = nil
    history[source] = nil
    cooldowns[source] = nil
end)

return M
