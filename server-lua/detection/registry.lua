local M = {}

---@alias DetectionCategory 'network' | 'movement' | 'combat' | 'vehicle' | 'integrity' | 'integration' | 'identity' | 'evidence'

---@class DetectionRule
---@field key string
---@field category DetectionCategory
---@field version number
---@field defaultSeverity number
---@field defaultConfidence number
---@field cooldownMs number
---@field strikeWindowMs number
---@field strikeDecayMs number
---@field cancellable boolean
---@field clientSourced boolean?
---@field announce boolean? default for printing accepted detections to the server console; a profile entry's announce overrides it
---@field validate fun(measured: table<string, any>, context: table<string, any>): boolean

---@type table<string, DetectionRule>
local rules = {}

---@param rule DetectionRule
function M.register(rule)
    if type(rule) ~= 'table' then error('detection rule must be a table') end
    if type(rule.key) ~= 'string' or not rule.key:match('^[a-z][a-z0-9_.]+$') then
        error('detection rule key is invalid')
    end
    if rules[rule.key] then error(('detection rule already registered: %s'):format(rule.key)) end
    if type(rule.validate) ~= 'function' then error(('detection rule %s has no validator'):format(rule.key)) end
    if rule.defaultSeverity < 0 or rule.defaultSeverity > 100 then error('severity must be between 0 and 100') end
    if rule.defaultConfidence < 0 or rule.defaultConfidence > 1 then error('confidence must be between 0 and 1') end

    rules[rule.key] = rule
end

---@param key string
---@return DetectionRule?
function M.get(key)
    return rules[key]
end

---@return table<string, DetectionRule>
function M.all()
    local result = {}
    for key, rule in pairs(rules) do result[key] = rule end
    return result
end

return M
