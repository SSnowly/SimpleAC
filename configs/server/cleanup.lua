return {
    -- Client event that revives a player. Matches qs-medical-creator's admin /revive command.
    reviveEvent = 'ambulance:revivePlayer',
    -- Players this player killed within this many seconds are revived by a cleanup.
    victimWindowSeconds = 900,
    -- Runs automatically right before a detection kicks or bans a player (skipped in debug mode).
    automatic = {
        enabled = true,
        deleteEntities = true,
        reviveVictims = true,
    },
}
