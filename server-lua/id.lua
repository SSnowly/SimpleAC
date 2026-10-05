local M = {}
local alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
local allowedPrefixes = {
    ['SAC-ACT'] = true,
    ['SAC-DET'] = true,
    ['SAC-CASE'] = true,
    ['SAC-BAN'] = true,
    ['SAC-EXC'] = true,
    ['SAC-ALW'] = true,
    ['SAC-PLY'] = true,
    ['SAC-SES'] = true,
    ['SAC-FP'] = true,
    ['SAC-CAP'] = true,
    ['SAC-OCR'] = true,
    ['SAC-WATCH'] = true,
    ['SAC-STR'] = true,
    ['SAC-VOICE'] = true,
    ['SAC-PRF'] = true,
    ['SAC-KEY'] = true,
}
local lastTimestamp = -1
local lastEntropy = ''

math.randomseed(os.time() + GetGameTimer())

---@param timestamp number
---@return string
local function encodeTimestamp(timestamp)
    local encoded = ''

    for _ = 1, 10 do
        local remainder = timestamp % 32
        encoded = alphabet:sub(remainder + 1, remainder + 1) .. encoded
        timestamp = math.floor(timestamp / 32)
    end

    return encoded
end

---@return string
local function randomEntropy()
    local encoded = ''

    for _ = 1, 16 do
        local index = math.random(1, #alphabet)
        encoded = encoded .. alphabet:sub(index, index)
    end

    return encoded
end

---@param entropy string
---@return string
local function incrementEntropy(entropy)
    local characters = {}

    for index = 1, #entropy do
        characters[index] = entropy:sub(index, index)
    end

    for index = #characters, 1, -1 do
        local position = alphabet:find(characters[index], 1, true)
        if not position then error('invalid ULID entropy state') end

        if position < #alphabet then
            characters[index] = alphabet:sub(position + 1, position + 1)
            return table.concat(characters)
        end

        characters[index] = alphabet:sub(1, 1)
    end

    error('monotonic ULID entropy exhausted for the current millisecond')
end

---@param prefix string
---@param timestamp number?
---@return string
function M.create(prefix, timestamp)
    if not allowedPrefixes[prefix] then error(('unsupported SimpleAC ID prefix: %s'):format(prefix)) end

    local now = timestamp or (os.time() * 1000 + (GetGameTimer() % 1000))
    if now < lastTimestamp then now = lastTimestamp end

    lastEntropy = now == lastTimestamp and incrementEntropy(lastEntropy) or randomEntropy()
    lastTimestamp = now

    return ('%s-%s%s'):format(prefix, encodeTimestamp(now), lastEntropy)
end

return M
