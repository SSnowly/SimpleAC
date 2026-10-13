local Config = require 'configs.server.permits'
local Logger = require 'server-lua.logger'
local M = {}

local MANIFESTS = { 'fxmanifest.lua', '__resource.lua' }

---@type string[]
local changed = {}

local MESSAGE = 'SimpleAC was just installed into this server. THE SERVER OWNER MUST RESTART THE SERVER, then you can join.'

---@return string
local function directive()
    return ("shared_script '@%s/init.lua'"):format(GetCurrentResourceName())
end

---@param resource string
---@return boolean? installed, string? reason
local function install(resource)
    for index = 1, #MANIFESTS do
        local file = MANIFESTS[index]
        local content = LoadResourceFile(resource, file)
        if content then
            if content:find('@' .. GetCurrentResourceName() .. '/init.lua', 1, true) then return false end

            local newline = content:find('\r\n', 1, true) and '\r\n' or '\n'
            local bom = content:sub(1, 3) == '\239\187\191' and '\239\187\191' or ''
            local updated = bom .. directive() .. newline .. content:sub(#bom + 1)
            if not SaveResourceFile(resource, file, updated, -1) then return nil, 'write_failed' end
            return true
        end
    end
    return nil, 'no_manifest'
end

---@return string[]
function M.run()
    changed = {}
    if not Config.autoInstall then return changed end

    local self = GetCurrentResourceName()
    local failed = {}
    for index = 0, GetNumResources() - 1 do
        local resource = GetResourceByFindIndex(index)
        if resource and resource ~= self and not Config.installExclude[resource] then
            local done, reason = install(resource)
            if done then
                changed[#changed + 1] = resource
            elseif done == nil and reason == 'write_failed' then
                failed[#failed + 1] = resource
            end
        end
    end

    if #failed > 0 then
        Logger.structured('warn', 'install_write_failed', { resources = failed })
    end
    if #changed > 0 then
        table.sort(changed)
        Logger.structured('warn', 'install_manifests_changed', { count = #changed, resources = changed })
        AddEventHandler('playerConnecting', function(_, _, deferrals)
            deferrals.defer()
            Wait(0)
            deferrals.done(MESSAGE)
        end)
        CreateThread(function()
            while true do
                print(('^3[SimpleAC] Installed init.lua into %d resource manifest(s). Restart the server to apply.^7'):format(#changed))
                Wait(60000)
            end
        end)
    end
    return changed
end

return M
