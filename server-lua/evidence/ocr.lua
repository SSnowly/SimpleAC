local Engine = require 'server-lua.detection.engine'
local Sessions = require 'server-lua.services.sessions'
local M = {}

local SEVERITIES = { low = true, medium = true, high = true }

---OCR text only ever contributes evidence: it raises a detection in `log` mode, which feeds cases and the
---correlation window like any other signal and never bans on its own.
function M.start()
    AddEventHandler('simpleac:internal:ocrMatch', function(event)
        if type(event) ~= 'table' or type(event.captureId) ~= 'string' or type(event.playerId) ~= 'string' then return end
        if not SEVERITIES[event.severity] then return end

        local source = Sessions.findSource(event.playerId)
        if not source then return end
        Engine.submit({
            rule = 'evidence.ocr_match',
            source = source,
            measured = {
                captureId = event.captureId,
                resultId = type(event.resultId) == 'string' and event.resultId or '',
                severity = event.severity,
                terms = type(event.terms) == 'string' and event.terms:sub(1, 200) or '',
                matchCount = tonumber(event.matchCount) or 1,
            },
        })
    end)
end

return M
