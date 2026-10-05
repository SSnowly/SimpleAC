-- Server-side vehicle baseline checks. Expected values come from shared/data/vehicle-baselines.json
-- (generated from the game's meta files) merged with vehicle-baselines.custom.json (addons/overrides).
return {
    minimumSampleIntervalMs = 1500,
    -- Relative tolerance applied to every sampled handling field unless `fields` overrides it.
    handlingTolerance = 0.02,
    -- Differences below this are ignored (float32 rounding around zero).
    absoluteEpsilon = 0.001,
    -- `scale` converts a meta value to the unit GetVehicleHandlingFloat returns. All 1.0 until
    -- verified on a live server; correct any entry that deviates for every stock vehicle.
    fields = {
        fMass = { scale = 1.0 },
        fInitialDragCoeff = { scale = 1.0 },
        fInitialDriveForce = { scale = 1.0 },
        fInitialDriveMaxFlatVel = { scale = 1.0 },
        fBrakeForce = { scale = 1.0 },
        fHandBrakeForce = { scale = 1.0 },
        fDriveInertia = { scale = 1.0 },
        fTractionCurveMax = { scale = 1.0 },
        fTractionCurveMin = { scale = 1.0 },
        fSuspensionForce = { scale = 1.0 },
        fAntiRollBarForce = { scale = 1.0 },
        fCollisionDamageMult = { scale = 1.0 },
        fWeaponDamageMult = { scale = 1.0 },
        fEngineDamageMult = { scale = 1.0 },
        fDeformationDamageMult = { scale = 1.0 },
    },
    -- Handling is checked once per vehicle per `recheckMs`; a single deviating field is enough.
    minimumDeviatingFields = 1,
    recheckMs = 15000,
    -- Boost: server-measured speed (m/s) must exceed maxFlatVel / 3.6 * multiplier + margin for
    -- `sustainedSamples` consecutive samples. Deliberately loose; tighten after profiling.
    speedCeilingMultiplier = 1.75,
    speedMarginMps = 8.0,
    sustainedSamples = 3,
    checkedTypes = {
        VEHICLE_TYPE_CAR = true,
        VEHICLE_TYPE_BIKE = true,
        VEHICLE_TYPE_QUADBIKE = true,
        VEHICLE_TYPE_AMPHIBIOUS_AUTOMOBILE = true,
        VEHICLE_TYPE_AMPHIBIOUS_QUADBIKE = true,
    },
}
