package.path = './?.lua;' .. package.path

local H = require 'tests.lua.harness'
local failures, passed = 0, 0
local T = { H = H }

function T.test(name, fn)
    H.reset()
    local ok, err = xpcall(fn, debug.traceback)
    if ok then
        passed = passed + 1
    else
        failures = failures + 1
        print(('FAIL  %s\n      %s'):format(name, tostring(err)))
    end
end

function T.eq(actual, expected, message)
    if actual ~= expected then
        error(('%s: expected %s, got %s'):format(message or 'values differ', tostring(expected), tostring(actual)), 2)
    end
end

function T.truthy(value, message)
    if not value then error(message or 'expected a truthy value', 2) end
end

package.loaded['tests.lua.framework'] = T

for _, file in ipairs({ 'rules', 'engine', 'grace', 'client_reports', 'vehicle', 'network', 'client_runtime', 'fingerprint', 'capture' }) do
    dofile(('tests/lua/%s_test.lua'):format(file))
end

print(('%d passed, %d failed'):format(passed, failures))
os.exit(failures == 0 and 0 or 1)
