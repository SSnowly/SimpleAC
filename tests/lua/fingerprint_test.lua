local T = require 'tests.lua.framework'
local Config = require 'configs.server.evasion'
local Registry = require 'server-lua.detection.rules'

local function fingerprint() return require 'server-lua.identity.fingerprint' end
local function evasion() return require 'server-lua.identity.evasion' end

local device = {
    userAgent = '  Mozilla/5.0 CitizenFX  ',
    platform = 'Win32',
    locale = 'en-US',
    timezone = 'Europe/Budapest',
    screenWidth = 1920,
    screenHeight = 1080,
    colorDepth = 24,
    pixelRatio = 1.25,
    hardwareConcurrency = 16,
    deviceMemory = 8,
    canvasSignature = 'AAAA',
    webglSignature = 'BBBB',
    webglRenderer = 'ANGLE (NVIDIA)',
    storageId = 'abcd',
}

local function hashesOf(attributes, withStorageId)
    local hashes = {}
    for name, value in pairs(attributes) do
        if withStorageId ~= false or name ~= 'storageId' then hashes[name] = 'h:' .. name .. '=' .. value end
    end
    return hashes
end

T.test('normalize trims, lowercases, clamps and drops unknown keys', function()
    local attributes = fingerprint().normalize(device)
    T.truthy(attributes, 'accepted')
    T.eq(attributes.userAgent, 'mozilla/5.0 citizenfx', 'trimmed and lowercased')
    T.eq(attributes.pixelRatio, '1.25', 'pixel ratio keeps two decimals')
    T.eq(attributes.screenWidth, '1920', 'integers are formatted without decimals')

    local noisy = {}
    for name, value in pairs(device) do noisy[name] = value end
    noisy.injected = 'x'
    noisy.screenWidth = 10 ^ 9
    local clamped = fingerprint().normalize(noisy)
    T.eq(clamped.injected, nil, 'unknown key dropped')
    T.eq(clamped.screenWidth, '20000', 'out of range value clamped')
end)

T.test('normalize rejects payloads with too little data', function()
    T.eq(fingerprint().normalize(nil), nil, 'nil')
    T.eq(fingerprint().normalize('x'), nil, 'wrong type')
    T.eq(fingerprint().normalize({ userAgent = 'x', locale = 'en' }), nil, 'too few attributes')
end)

T.test('the composite fingerprint ignores the storage id and the audio signature', function()
    local a = fingerprint().normalize(device)
    local copy = {}
    for name, value in pairs(device) do copy[name] = value end
    copy.storageId = 'different'
    copy.audioSignature = 'CCCC'
    local b = fingerprint().normalize(copy)
    T.eq(fingerprint().compositeInput(a), fingerprint().compositeInput(b), 'same device')
    copy.canvasSignature = 'ZZZZ'
    T.truthy(fingerprint().compositeInput(a) ~= fingerprint().compositeInput(fingerprint().normalize(copy)),
        'canvas change splits the device')
end)

T.test('a shared device token is the strongest single signal', function()
    local hashes = hashesOf(fingerprint().normalize(device))
    local score, signals = evasion().score(
        { hashes = hashes, fingerprintId = 'SAC-FP-A' },
        { hashes = {}, fingerprintId = 'SAC-FP-B', sharedToken = true, sharedIp = false })
    T.eq(score, Config.weights.deviceToken, 'token only')
    T.eq(signals[1].signal, 'deviceToken', 'explained')
end)

T.test('an ip-only match stays weak and an exact fingerprint is supporting evidence', function()
    local hashes = hashesOf(fingerprint().normalize(device))
    local ipOnly = evasion().score(
        { hashes = hashes, fingerprintId = 'A' },
        { hashes = {}, fingerprintId = 'B', sharedToken = false, sharedIp = true })
    T.eq(ipOnly, Config.weights.ip, 'ip weight')
    T.truthy(evasion().outcomeFor(ipOnly) == nil, 'weak match never reaches an outcome')

    local noStorage = hashesOf(fingerprint().normalize(device), false)
    local exact = evasion().score(
        { hashes = hashes, fingerprintId = 'A' },
        { hashes = noStorage, fingerprintId = 'A', sharedToken = false, sharedIp = false })
    T.truthy(exact >= Config.weights.fingerprintExact, 'exact match counts')
    T.truthy(evasion().outcomeFor(exact) == nil, 'fingerprint alone is below the review threshold')
end)

T.test('partial attribute matches are summed and capped, and every signal is listed', function()
    local hashes = hashesOf(fingerprint().normalize(device), false)
    local score, signals = evasion().score(
        { hashes = hashes, fingerprintId = 'A' },
        { hashes = hashes, fingerprintId = 'OTHER', sharedToken = false, sharedIp = false })
    T.truthy(score <= Config.weights.attributeCap, 'capped')
    T.truthy(#signals == 1 and signals[1].signal:find('attributes', 1, true), 'attribute signal named')
    T.truthy(signals[1].signal:find('canvas', 1, true), 'lists the matching groups')

    local missing = evasion().score(
        { hashes = hashes, fingerprintId = 'A' },
        { hashes = { canvasSignature = 'other' }, fingerprintId = 'B', sharedToken = false, sharedIp = false })
    T.eq(missing, 0, 'different hashes never match')
end)

T.test('token plus fingerprint reaches review and outcomes honour the configured thresholds', function()
    local hashes = hashesOf(fingerprint().normalize(device))
    local score = evasion().score(
        { hashes = hashes, fingerprintId = 'A' },
        { hashes = hashes, fingerprintId = 'A', sharedToken = true, sharedIp = true })
    T.eq(score, 100, 'combined score is capped at 100')
    T.eq(evasion().outcomeFor(score), 'restrict', 'block is disabled by default')
    T.eq(evasion().outcomeFor(Config.outcomes.review), 'review', 'review threshold')
    T.eq(evasion().outcomeFor(Config.outcomes.review - 1), nil, 'below review')
    T.eq(evasion().describe({ { signal = 'deviceToken', weight = 60 }, { signal = 'ip', weight = 8 } }),
        'deviceToken:60;ip:8', 'describe')
end)

T.test('ban evasion is a server-only rule that needs a complete measurement', function()
    local rule = Registry.get('identity.ban_evasion')
    T.eq(rule.clientSourced, nil, 'clients cannot submit it')
    T.eq(rule.validate({ score = 70, outcome = 'review', targetPlayerId = 'SAC-PLY-X', banId = 'SAC-BAN-X',
        signals = 'deviceToken:60' }), true, 'complete')
    T.eq(rule.validate({ score = 70, outcome = 'ban', targetPlayerId = 'SAC-PLY-X', banId = 'SAC-BAN-X',
        signals = 'x' }), false, 'unknown outcome')
    T.eq(rule.validate({ score = 70, outcome = 'review' }), false, 'missing target')
end)
