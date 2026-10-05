local Config = require 'configs.shared.main'

---@param ... any
local function debugPrint(...)
    if not Config.debug then return end

    local side = IsDuplicityVersion() and '^5[SimpleAC:server]^7' or '^6[SimpleAC:client]^7'
    print(side, ...)
end

return debugPrint
