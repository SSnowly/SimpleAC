local Config = require 'configs.client.detections'

local settings = Config.nuiDevtools
if not settings.enabled then return end

local lastAlive = nil
local sentChecks = 0

-- Every progressEvery-th consecutive check is reported; reaching confirmChecks is the final report.
local function report(method, checks)
    if checks <= sentChecks or checks % settings.progressEvery ~= 0 then return end
    sentChecks = checks
    local rule = checks >= settings.confirmChecks and 'integrity.nui_devtools' or 'integrity.nui_devtools_progress'
    TriggerServerEvent('simpleac:detection:clientReport', rule, {
        method = method,
        checks = checks,
        clientTimer = GetGameTimer(),
    })
end

RegisterNUICallback('nuiAlive', function(_, cb)
    cb({})
    lastAlive = GetGameTimer()
end)

RegisterNUICallback('nuiDevtools', function(data, cb)
    cb({})
    if type(data) ~= 'table' or data.method ~= 'debugger' or type(data.checks) ~= 'number' then return end
    report('debugger', data.checks)
end)

-- A page held on a breakpoint stops pinging, so a gap of N intervals is the same signal as N slow probes.
CreateThread(function()
    Wait(1000)
    SendNUIMessage({ action = 'simpleac:config', config = {
        intervalMs = settings.intervalMs,
        debuggerThresholdMs = settings.debuggerThresholdMs,
        progressEvery = settings.progressEvery,
    } })
    while true do
        Wait(settings.intervalMs)
        if lastAlive then
            local checks = math.floor((GetGameTimer() - lastAlive) / settings.intervalMs)
            if checks == 0 then sentChecks = 0 end
            report('stalled', checks)
        end
    end
end)
