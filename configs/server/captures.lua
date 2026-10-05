return {
    enabled = true,
    -- Minimum time between two captures of the same player, whatever triggered them.
    perPlayerCooldownMs = 5000,
    -- Requested captures that have not been uploaded yet, across all players.
    maximumPending = 6,
    -- 'jpg' or 'png' can be read by OCR; 'webp' is smaller but is stored without OCR.
    encoding = 'jpg',
    -- 0.3 - 1.0 for jpg and webp.
    quality = 0.82,
    -- Wider screenshots are scaled down before upload.
    maxWidth = 1920,
    -- Bandwidth the client may use to send a screenshot through the game connection (bytes per second).
    latentBytesPerSecond = 262144,
    -- Longest delay and burst a request may ask for.
    maximumDelayMs = 60000,
    maximumBurst = 5,

    -- A screenshot taken when one of these rules produces a detection, linked to that detection.
    automatic = {
        enabled = true,
        cooldownMs = 60000,
        rules = {
            ['movement.noclip'] = true,
            ['movement.freecam'] = true,
            ['state.godmode'] = true,
            ['state.vision'] = true,
            ['combat.fire_rate'] = true,
            ['combat.infinite_ammo'] = true,
            ['vehicle.boost'] = true,
            ['vehicle.handling_modified'] = true,
            ['integrity.nui_devtools_progress'] = true,
            ['identity.ban_evasion'] = true,
        },
    },

    -- Rotating sweep so every connected player is screenshotted (and OCR-scanned) on a schedule. The pace follows the
    -- player count: with N players a capture starts about every intervalMs / N, never faster than minimumGapMs, so
    -- the OCR worker and the upload bandwidth keep a fixed budget however large the server gets.
    sweep = {
        enabled = true,
        -- Target time between two screenshots of the same player.
        intervalMs = 30000,
        -- Floor for the time between two sweep captures of anyone. Players beyond intervalMs / minimumGapMs are
        -- simply seen less often.
        minimumGapMs = 1500,
        -- Sweep stops requesting while this many captures (of any trigger) wait for an upload, which leaves
        -- the rest of maximumPending for detections and staff.
        maximumPending = 3,
        -- OCR reads 'jpg' and 'png'; jpg keeps the upload small.
        encoding = 'jpg',
    },

    -- Occasional screenshots of random connected players. Off by default.
    random = {
        enabled = false,
        intervalMs = 300000,
        jitterMs = 120000,
    },
}
