return {
    teleportDistance = 150.0,
    noclipDistance = 12.0,
    footSpeed = 14.0,
    freecamDistance = 35.0,
    superJumpHeight = 8.0,
    vehicleSpeed = 100.0,
    healthIncrease = 50,
    armourIncrease = 50,
    vehicleRepairIncrease = 300.0,
    minimumAlpha = 180,
    maximumShotsPerSecond = 16,
    godmodeProofs = 3,
    infiniteAmmoShots = 8,
    vehicleWarpExcess = 120.0,
    -- Set false on servers that disable ragdoll on purpose (reports state.ragdoll_disabled).
    checkRagdoll = true,
    -- NUI DevTools probes (see nui/devtools.js). Every progressEvery-th consecutive detection is reported as
    -- integrity.nui_devtools_progress (log only); confirmChecks consecutive detections (confirmChecks *
    -- intervalMs of grace to close DevTools) is the final integrity.nui_devtools report.
    nuiDevtools = {
        enabled = true,
        intervalMs = 2000,
        debuggerThresholdMs = 100,
        progressEvery = 5,
        confirmChecks = 10,
    },
    -- Device fingerprint and persistent token (see nui/fingerprint.js and docs/developer/fingerprinting.md).
    fingerprint = { enabled = true, delayMs = 8000, retryMs = 20000 },
    vehicleSampleTicks = 4,
    vehicleHandlingFields = {
        'fMass', 'fInitialDragCoeff', 'fInitialDriveForce', 'fInitialDriveMaxFlatVel', 'fBrakeForce',
        'fHandBrakeForce', 'fDriveInertia', 'fTractionCurveMax', 'fTractionCurveMin', 'fSuspensionForce',
        'fAntiRollBarForce', 'fCollisionDamageMult', 'fWeaponDamageMult', 'fEngineDamageMult',
        'fDeformationDamageMult',
    },
}
