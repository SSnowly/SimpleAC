-- Server-owned suppression windows for client-sourced detections during common legitimate flows.
-- `categories` lists the detection categories ignored while the window is open. `cooldownMs`
-- limits how often a client-hinted kind can be granted, capping what a spoofed hint can buy.
return {
    join = { durationMs = 30000, categories = { 'movement', 'state', 'vehicle', 'combat' } },
    hints = {
        respawn = { durationMs = 8000, cooldownMs = 60000, categories = { 'movement', 'state' }, requiresAlive = true },
        cutscene = { durationMs = 6000, cooldownMs = 30000, categories = { 'movement', 'state' } },
        loading = { durationMs = 8000, cooldownMs = 30000, categories = { 'movement', 'state', 'vehicle' } },
        interior = { durationMs = 3000, cooldownMs = 10000, categories = { 'movement' } },
    },
    maximumDurationMs = 10000,
}
