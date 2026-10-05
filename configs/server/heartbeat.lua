return {
    challengeIntervalMs = 15000,
    responseDeadlineMs = 10000,
    joinGraceMs = 45000,
    maximumConsecutiveFailures = 2,
    -- While false, failures are recorded as detections but never produce a ban or a kick.
    banOnFailure = false,
    temporaryBanHours = 24,
    maximumSchedulerGapMs = 4000,
    requiredClientResources = { 'SimpleAC', 'ox_lib' },
}
