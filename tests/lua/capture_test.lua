local T = require 'tests.lua.framework'
local H = T.H
local Config = require 'configs.server.captures'

local clientEvents, localEvents, statements, convars

local function setup(sweepWait, players)
    Config.sweep.enabled = sweepWait ~= nil
    clientEvents, localEvents, statements, convars = {}, {}, {}, {}
    local counter = 0
    MySQL = {
        scalar = { await = function()
            counter = counter + 1
            return ('%064x'):format(counter)
        end },
        transaction = { await = function(queries)
            for _, query in ipairs(queries) do statements[#statements + 1] = query end
            return true
        end },
        update = { await = function() return 1 end },
    }
    TriggerClientEvent = function(name, target, payload)
        clientEvents[#clientEvents + 1] = { name = name, target = target, payload = payload }
    end
    TriggerEvent = function(name, ...) localEvents[#localEvents + 1] = { name = name, args = { ... } } end
    GetConvar = function(name, default) return convars[name] or default end
    GetInvokingResource = function() return 'simpleac' end
    GetPlayers = function() return players or {} end
    Wait = sweepWait or function() end
    exports = function() end
    RegisterCommand = function() end
    package.loaded['server-lua.evidence.capture'] = nil
    local capture = require 'server-lua.evidence.capture'
    capture.start()
    return capture
end

T.test('a request stores the row, mints a token and asks the client for a screenshot', function()
    local capture = setup()
    H.addPlayer(1)
    local result = capture.request({ source = 1, trigger = 'manual', reason = 'spot check' })
    T.eq(result.ok, true, 'accepted')
    T.eq(#result.ids, 1, 'one capture')
    T.eq(#clientEvents, 1, 'client asked')
    local request = clientEvents[1].payload
    T.eq(clientEvents[1].name, 'simpleac:capture:request', 'event name')
    T.eq(#request.token, 64, 'token')
    T.eq(request.id, result.ids[1], 'id matches')
    T.eq(request.encoding, Config.encoding, 'default encoding')
    T.eq(request.uploadUrl, nil, 'no direct upload without an HTTPS base URL')
    T.truthy(statements[1].query:find('INSERT INTO sac_captures', 1, true), 'row inserted')
    T.truthy(statements[2].query:find('INSERT INTO sac_actions', 1, true), 'ledger action written')
end)

T.test('direct upload is only offered over HTTPS', function()
    local capture = setup()
    H.addPlayer(1)
    convars['simpleac:capture_upload_url'] = 'http://example.com/SimpleAC'
    capture.request({ source = 1, trigger = 'manual', reason = 'x' })
    T.eq(clientEvents[1].payload.uploadUrl, nil, 'plain HTTP is never offered')

    H.advance(Config.perPlayerCooldownMs + 1)
    convars['simpleac:capture_upload_url'] = 'https://ac.example.com/SimpleAC/'
    capture.request({ source = 1, trigger = 'manual', reason = 'x' })
    local url = clientEvents[2].payload.uploadUrl
    T.truthy(url and url:find('^https://ac.example.com/SimpleAC/v1/captures/upload/%x+$'), 'HTTPS URL with token')
end)

T.test('the per-player cooldown applies and then expires', function()
    local capture = setup()
    H.addPlayer(1)
    T.eq(capture.request({ source = 1, trigger = 'manual', reason = 'x' }).ok, true, 'first')
    local second = capture.request({ source = 1, trigger = 'manual', reason = 'x' })
    T.eq(second.ok, false, 'second blocked')
    T.eq(second.reason, 'cooldown', 'reason')
    H.advance(Config.perPlayerCooldownMs + 1)
    T.eq(capture.request({ source = 1, trigger = 'manual', reason = 'x' }).ok, true, 'after the cooldown')
end)

T.test('offline players and a full pending queue are refused, and a stored upload frees a slot', function()
    local capture = setup()
    T.eq(capture.request({ source = 99, trigger = 'manual', reason = 'x' }).reason, 'player_offline', 'no session')

    local ids = {}
    for source = 1, Config.maximumPending do
        H.addPlayer(source)
        ids[source] = capture.request({ source = source, trigger = 'manual', reason = 'x' }).ids[1]
    end
    H.addPlayer(50)
    T.eq(capture.request({ source = 50, trigger = 'manual', reason = 'x' }).reason, 'busy', 'queue full')

    H.handlers['simpleac:internal:captureStored'](ids[1])
    H.advance(Config.perPlayerCooldownMs + 1)
    T.eq(capture.request({ source = 50, trigger = 'manual', reason = 'x' }).ok, true, 'slot freed')
end)

T.test('a burst sends every shot and labels them', function()
    local capture = setup()
    H.addPlayer(1)
    local result = capture.request({
        source = 1, trigger = 'manual', reason = 'x', burst = { count = 3, intervalMs = 1000 },
    })
    T.eq(result.ok, true, 'accepted')
    T.eq(#clientEvents, 3, 'three screenshots requested')
    T.truthy(statements[1].values[5] == 'burst', 'stored as a burst')
end)

T.test('only the requested player can deliver a screenshot, once', function()
    local capture = setup()
    H.addPlayer(1)
    H.addPlayer(2)
    local id = capture.request({ source = 1, trigger = 'manual', reason = 'x' }).ids[1]
    local token = clientEvents[1].payload.token

    H.fireNet(2, 'simpleac:capture:data', id, token, 'image/jpeg', 'QUJD')
    T.eq(#localEvents, 0, 'another player cannot deliver it')

    H.fireNet(1, 'simpleac:capture:data', id, token, 'image/jpeg', 'QUJD')
    T.eq(#localEvents, 1, 'delivered')
    T.eq(localEvents[1].name, 'simpleac:internal:captureUpload', 'forwarded to the control plane')
    T.eq(localEvents[1].args[1], id, 'capture id')

    H.fireNet(1, 'simpleac:capture:data', id, token, 'image/jpeg', 'QUJD')
    T.eq(#localEvents, 1, 'a second delivery is ignored')
    local _ = capture
end)

T.test('malformed and oversized deliveries are dropped', function()
    local capture = setup()
    H.addPlayer(1)
    local id = capture.request({ source = 1, trigger = 'manual', reason = 'x' }).ids[1]
    local token = clientEvents[1].payload.token
    H.fireNet(1, 'simpleac:capture:data', id, 'short', 'image/jpeg', 'QUJD')
    T.eq(#localEvents, 0, 'bad token')

    H.advance(Config.perPlayerCooldownMs + 1)
    local second = capture.request({ source = 1, trigger = 'manual', reason = 'x' }).ids[1]
    local limit = 4 * 1024 * 1024 * 4 // 3 + 8
    H.fireNet(1, 'simpleac:capture:data', second, clientEvents[2].payload.token, 'image/jpeg', ('A'):rep(limit + 1))
    T.eq(#localEvents, 0, 'oversized payload')
    local _ = token
end)

T.test('automatic captures follow the configured rules and their own cooldown', function()
    local capture = setup()
    H.addPlayer(1)
    capture.onDetection(1, { rule = { key = 'movement.teleport' }, detectionId = 'SAC-DET-1' })
    T.eq(#clientEvents, 0, 'rules outside the list never capture')

    capture.onDetection(1, { rule = { key = 'state.godmode' }, detectionId = 'SAC-DET-2' })
    T.eq(#clientEvents, 1, 'listed rule captures')
    T.eq(statements[1].values[3], 'SAC-DET-2', 'linked to the detection')

    H.advance(Config.perPlayerCooldownMs + 1)
    capture.onDetection(1, { rule = { key = 'state.godmode' }, detectionId = 'SAC-DET-3' })
    T.eq(#clientEvents, 1, 'automatic cooldown holds')
end)

T.test('the sweep visits the most overdue player first, one per tick', function()
    H.addPlayer(1)
    H.addPlayer(2)
    local waits = 0
    setup(function()
        waits = waits + 1
        if waits > 3 then error('stop the sweep loop') end
        H.advance(Config.sweep.intervalMs)
    end, { '1', '2' })
    Config.sweep.enabled = false
    T.eq(#clientEvents, 3, 'three ticks, three captures')
    T.eq(clientEvents[1].target, 1, 'first tick: first player')
    T.eq(clientEvents[2].target, 2, 'second tick: the player not seen yet')
    T.eq(clientEvents[3].target, 1, 'third tick: back to the oldest')
end)
