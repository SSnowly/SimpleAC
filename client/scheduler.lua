local M = {}
local tasks = {}
local health = { lastTick = GetGameTimer(), tickCount = 0, maximumGapMs = 0 }
-- The client runtime has no `os` library; GetGameTimer is the only clock, so timings have 1 ms resolution.
local clock = function() return GetGameTimer() * 1000000 end

---@class SchedulerTaskOptions
---@field maxBackoff number? Largest interval multiplier applied while the task reports 'idle'.

---Registers a staggered, jittered periodic task. A callback may return 'idle' to back its interval
---off (doubling up to `maxBackoff`); any other return value restores the base interval.
---@param name string
---@param intervalMs number
---@param jitterMs number
---@param callback fun(): 'idle'?
---@param options SchedulerTaskOptions?
function M.every(name, intervalMs, jitterMs, callback, options)
    tasks[name] = {
        interval = intervalMs,
        jitter = jitterMs or 0,
        callback = callback,
        maxBackoff = options and options.maxBackoff or 1,
        backoff = 1,
        nextRun = GetGameTimer() + math.random(math.min(250, intervalMs), math.max(250, intervalMs)),
        runs = 0,
        idleRuns = 0,
        failures = 0,
        maxDuration = 0,
        totalNs = 0,
        maxNs = 0,
    }
end

function M.snapshot()
    local components = {}
    for name, task in pairs(tasks) do
        components[name] = { runs = task.runs, failures = task.failures, maxDurationMs = task.maxDuration }
    end
    return { tickCount = health.tickCount, ageMs = math.max(0, GetGameTimer() - health.lastTick),
        maximumGapMs = health.maximumGapMs, components = components }
end

---Per-task timing for profiling against the client performance budgets.
---@return table<string, { runs: number, idleRuns: number, averageMs: number, maxMs: number, backoff: number }>
function M.profile()
    local result = {}
    for name, task in pairs(tasks) do
        result[name] = {
            runs = task.runs,
            idleRuns = task.idleRuns,
            averageMs = task.runs > 0 and (task.totalNs / task.runs) / 1e6 or 0,
            maxMs = task.maxNs / 1e6,
            backoff = task.backoff,
        }
    end
    return result
end

function M.resetMaximumGap() health.maximumGapMs = 0 end

CreateThread(function()
    while true do
        Wait(100)
        local now = GetGameTimer()
        health.maximumGapMs = math.max(health.maximumGapMs, now - health.lastTick)
        health.lastTick, health.tickCount = now, health.tickCount + 1
        for _, task in pairs(tasks) do
            if now >= task.nextRun then
                local started, startedNs = GetGameTimer(), clock()
                local ok, outcome = xpcall(task.callback, debug.traceback)
                local elapsedNs = clock() - startedNs
                task.runs = task.runs + 1
                task.totalNs = task.totalNs + elapsedNs
                task.maxNs = math.max(task.maxNs, elapsedNs)
                if not ok then task.failures = task.failures + 1 end
                task.maxDuration = math.max(task.maxDuration, GetGameTimer() - started)
                if ok and outcome == 'idle' then
                    task.idleRuns = task.idleRuns + 1
                    task.backoff = math.min(task.maxBackoff, task.backoff * 2)
                else
                    task.backoff = 1
                end
                task.nextRun = now + task.interval * task.backoff + math.random(-task.jitter, task.jitter)
            end
        end
    end
end)

RegisterCommand('simpleac_profile', function()
    local names = {}
    for name in pairs(M.profile()) do names[#names + 1] = name end
    table.sort(names)
    local profile = M.profile()
    local totalPerSecond = 0
    for index = 1, #names do
        local entry = profile[names[index]]
        local task = tasks[names[index]]
        local callsPerSecond = 1000 / (task.interval * entry.backoff)
        totalPerSecond = totalPerSecond + entry.averageMs * callsPerSecond
        print(('[SimpleAC] %-14s runs=%d idle=%d avg=%.4fms max=%.4fms backoff=x%d'):format(
            names[index], entry.runs, entry.idleRuns, entry.averageMs, entry.maxMs, entry.backoff))
    end
    print(('[SimpleAC] estimated detection cost: %.4f ms/second (%.4f ms/frame at 60fps)'):format(
        totalPerSecond, totalPerSecond / 60))
end, false)

return M
