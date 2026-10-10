local M = {}

local WAIT_MS = 15000

---Cryptographically secure random bytes as lowercase hex, produced by the Node side of this resource.
---MariaDB has no RANDOM_BYTES(), so secrets are never generated in SQL. Waits for the export to register.
---@param bytes number
---@return string? hex
function M.hex(bytes)
    local deadline = GetGameTimer() + WAIT_MS
    repeat
        local ok, value = pcall(function()
            return exports[GetCurrentResourceName()]:SecureRandomHex(bytes)
        end)
        if ok and type(value) == 'string' and #value == bytes * 2 then return value end
        Wait(100)
    until GetGameTimer() >= deadline
    return nil
end

return M
