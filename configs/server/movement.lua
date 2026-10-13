return {
    -- Temporary: prints every fast sample and every submission result to the console.
    debugLog = false,
    intervalMs = 1000,
    -- Metres per second over the ground (z ignored so falling and skydiving do not count).
    footSpeed = 30.0,
    vehicleSpeed = 150.0,
    -- A single step further than this is treated as a teleport and ignored.
    teleportDistance = 1500.0,
    -- Consecutive over-limit samples before a detection is submitted.
    consecutiveSamples = 3,
}
