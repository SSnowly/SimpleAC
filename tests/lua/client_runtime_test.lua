local T = require 'tests.lua.framework'

T.test('client scheduler loads without the os library (absent in the client runtime)', function()
    local savedOs, savedRegister, savedThread = os, RegisterCommand, CreateThread
    os = nil
    RegisterCommand = function() end
    CreateThread = function() end
    package.loaded['client.scheduler'] = nil
    local ok, result = pcall(dofile, 'client/scheduler.lua')
    os, RegisterCommand, CreateThread = savedOs, savedRegister, savedThread
    package.loaded['client.scheduler'] = nil
    if not ok then error(result, 0) end
    T.truthy(type(result.every) == 'function', 'scheduler exports every()')
end)

T.test('scheduler accepts intervals shorter than the initial stagger floor', function()
    local savedRegister, savedThread = RegisterCommand, CreateThread
    RegisterCommand = function() end
    CreateThread = function() end
    package.loaded['client.scheduler'] = nil
    local scheduler = dofile('client/scheduler.lua')
    RegisterCommand, CreateThread = savedRegister, savedThread
    package.loaded['client.scheduler'] = nil
    for _, interval in ipairs({ 20, 100, 250, 1000 }) do
        local ok, err = pcall(scheduler.every, 'task' .. interval, interval, 10, function() end)
        if not ok then error(('interval %d: %s'):format(interval, tostring(err)), 0) end
    end
end)
