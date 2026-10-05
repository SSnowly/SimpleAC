local Allowances = require 'server-lua.detection.allowances'
local Context = require 'server-lua.detection.context'
local Engine = require 'server-lua.detection.engine'
local ProtectedEvents = require 'server-lua.protections.protected_events'
local M = {}

---@return string?
local function caller()
    local resourceName = GetInvokingResource()
    if type(resourceName) ~= 'string' or resourceName == '' or resourceName == GetCurrentResourceName() then return nil end
    return resourceName
end

function M.start()
    exports('AllowAction', function(source, behavior, durationMs, reason)
        local resourceName = caller()
        if not resourceName then return nil end
        return Allowances.create(source, behavior, resourceName, durationMs, reason)
    end)

    exports('RevokeAllowance', function(allowanceId)
        local resourceName = caller()
        if not resourceName or type(allowanceId) ~= 'string' then return false end
        return Allowances.revoke(allowanceId, resourceName)
    end)

    exports('IsActionAllowed', function(source, behavior)
        local resourceName = caller()
        if not resourceName or type(source) ~= 'number' or type(behavior) ~= 'string' then return false end
        return Allowances.isAllowed(source, behavior, resourceName)
    end)

    exports('RegisterProtectedEvent', function(eventName, definition, handler)
        local resourceName = caller()
        if not resourceName then return false end
        return ProtectedEvents.register(eventName, definition, handler, resourceName)
    end)

    exports('RegisterSafeZone', function(id, definition)
        if not caller() then return false end
        return Context.registerSafeZone(id, definition)
    end)

    exports('RegisterEntityAllowance', function(source, durationMs, reason)
        local resourceName = caller()
        if not resourceName then return nil end
        return Allowances.create(source, 'network.entity_rate', resourceName, durationMs, reason)
    end)

    exports('RegisterCombatAllowance', function(source, behavior, durationMs, reason)
        local resourceName = caller()
        if not resourceName or (behavior ~= 'combat.weapon' and behavior ~= 'combat.loadout'
            and behavior ~= 'combat.damage') then return nil end
        return Allowances.create(source, behavior, resourceName, durationMs, reason)
    end)

    exports('SetPlayerContext', function(source, key, value)
        if not caller() then return false end
        return Context.setPlayer(source, key, value)
    end)

    exports('SubmitDetection', function(signal)
        local resourceName = caller()
        if not resourceName or type(signal) ~= 'table' then return { accepted = false, reason = 'invalid_caller' } end
        return Engine.submit({
            rule = signal.rule,
            source = signal.source,
            measured = signal.measured,
            resourceName = resourceName,
        })
    end)

    exports('GetRiskState', function(source)
        if not caller() or type(source) ~= 'number' then return nil end
        return Engine.getRiskState(source)
    end)
end

return M
