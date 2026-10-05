local Id = require 'server-lua.id'
local M = {}

---@alias ActionActorType 'system' | 'staff' | 'resource' | 'console' | 'ingame_panel' | 'web_api'

---@class ActionInput
---@field correlationId string?
---@field actorType ActionActorType
---@field actorId string?
---@field actionType string
---@field targetType string?
---@field targetId string?
---@field reason string?
---@field metadata table<string, any>?
---@field origin string

---@class ActionRecord
---@field id string
---@field correlationId string
---@field query string
---@field values any[]

---@param input ActionInput
---@return ActionRecord
function M.statement(input)
    local actionId = Id.create('SAC-ACT')
    local correlationId = input.correlationId or actionId

    return {
        id = actionId,
        correlationId = correlationId,
        query = [[INSERT INTO sac_actions (
            id, correlation_id, actor_type, actor_id, action_type, target_type,
            target_id, reason, metadata_json, origin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)]],
        values = {
            actionId,
            correlationId,
            input.actorType,
            input.actorId or 'simpleac',
            input.actionType,
            input.targetType or 'none',
            input.targetId or 'none',
            input.reason or '',
            json.encode(input.metadata or {}),
            input.origin,
        },
    }
end

---@param input ActionInput
---@return string, string
function M.create(input)
    local action = M.statement(input)
    MySQL.insert.await(action.query, action.values)
    return action.id, action.correlationId
end

return M
