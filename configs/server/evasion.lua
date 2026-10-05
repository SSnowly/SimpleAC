return {
    enabled = true,
    -- Bump when the normalized attribute set or hashing changes; fingerprints of different versions never match.
    algorithmVersion = 1,
    -- Fingerprint submissions accepted per session (the first one, plus one retry).
    maximumSubmissions = 2,
    candidateLimit = 25,
    -- Links below this score are not stored.
    minimumLinkScore = 20,
    weights = {
        -- Server-issued token stored in client KVP and NUI storage. Strongest device signal.
        deviceToken = 60,
        -- Random id kept in NUI storage. Cleared with the browser cache.
        storageId = 30,
        -- Every device attribute matches. Supporting evidence on its own.
        fingerprintExact = 35,
        -- Partial matches are summed per attribute, capped at attributeCap.
        attributes = {
            canvas = 12,
            webglSignature = 12,
            audio = 10,
            webglRenderer = 4,
            screen = 4,
            userAgent = 3,
            timezone = 2,
            locale = 1,
            hardware = 3,
        },
        attributeCap = 40,
        -- Same hashed IP seen on the other identity. Weak by itself (shared networks, CGNAT).
        ip = 8,
    },
    -- Minimum combined score per outcome; omit an outcome to disable it. Outcomes only apply when the matched
    -- identity has an active ban; every other match is just recorded as an identity link.
    --   review:   raises identity.ban_evasion so staff see it (log, announce)
    --   restrict: also sets the simpleacRestricted state bag
    --   block:    also drops the player (the connection check already blocks their other identifiers)
    -- Block is off by default; a fingerprint-only match should not remove players on its own.
    outcomes = {
        review = 45,
        restrict = 80,
    },
}
