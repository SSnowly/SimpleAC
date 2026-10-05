local T = require 'tests.lua.framework'
local H = T.H

local ADDER = 3078201489

local base = {
    handlings = {
        ADDER = { fMass = 1800, fInitialDriveForce = 0.32, fInitialDriveMaxFlatVel = 160, fCollisionDamageMult = 1.0 },
        BUS = { fMass = 9000, fInitialDriveMaxFlatVel = 80 },
    },
    vehicles = {
        adder = { hash = ADDER, handlingId = 'ADDER', type = 'VEHICLE_TYPE_CAR' },
        bus = { hash = 1, handlingId = 'BUS', type = 'VEHICLE_TYPE_CAR' },
        buzzard = { hash = 2, handlingId = 'BUS', type = 'VEHICLE_TYPE_HELI' },
    },
}

local function setup(custom)
    H.addPlayer(1)
    H.netHandlers = {}
    local baseline = require 'server-lua.vehicles.baseline'
    baseline.use(base, custom)
    local engine = require 'server-lua.detection.engine'
    local original = engine.submit
    local submitted = {}
    engine.submit = function(signal) submitted[#submitted + 1] = signal return {} end
    require('server-lua.protections.vehicle').start()
    return submitted, function() engine.submit = original end
end

local function sample(fields, airborne)
    H.advance(2000)
    H.fireNet(1, 'simpleac:vehicle:sample', { fields = fields or {}, airborne = airborne or false })
end

T.test('stock handling produces no detection', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 20.0)
    sample({ fMass = 1800.0, fInitialDriveForce = 0.3199999928, fCollisionDamageMult = 1.0 })
    restore()
    T.eq(#submitted, 0)
end)

T.test('modified handling is reported with the deviating field', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 20.0)
    sample({ fMass = 1800.0, fInitialDriveForce = 1.6, fCollisionDamageMult = 0.0 })
    restore()
    T.eq(#submitted, 1)
    T.eq(submitted[1].rule, 'vehicle.handling_modified')
    T.eq(submitted[1].measured.deviations, 2)
    T.eq(submitted[1].measured.model, 'adder')
end)

T.test('handling is rechecked only after the interval', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 20.0)
    sample({ fInitialDriveForce = 1.6 })
    sample({ fInitialDriveForce = 1.6 })
    T.eq(#submitted, 1, 'second sample inside recheckMs is ignored')
    H.advance(16000)
    sample({ fInitialDriveForce = 1.6 })
    restore()
    T.eq(#submitted, 2)
end)

T.test('custom handling overrides become the expectation', function()
    local submitted, restore = setup({ handlings = { ADDER = { fInitialDriveForce = 1.6 } } })
    H.putInVehicle(1, ADDER, 20.0)
    sample({ fInitialDriveForce = 1.6 })
    restore()
    T.eq(#submitted, 0)
end)

T.test('addon vehicles resolve through the custom file', function()
    local submitted, restore = setup({
        handlings = { MYCAR = { fMass = 1000, fInitialDriveMaxFlatVel = 100 } },
        vehicles = { mycar = { handlingId = 'mycar', type = 'VEHICLE_TYPE_CAR' } },
    })
    H.putInVehicle(1, GetHashKey('mycar'), 10.0)
    sample({ fMass = 2000.0 })
    restore()
    T.eq(#submitted, 1)
    T.eq(submitted[1].measured.model, 'mycar')
end)

T.test('sustained speed above the ceiling is boost, a single spike is not', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 200.0)
    sample() sample()
    T.eq(#submitted, 0, 'two samples are not sustained')
    H.putInVehicle(1, ADDER, 20.0)
    sample()
    H.putInVehicle(1, ADDER, 200.0)
    sample() sample()
    T.eq(#submitted, 0, 'a normal sample resets the streak')
    sample()
    restore()
    T.eq(#submitted, 1)
    T.eq(submitted[1].rule, 'vehicle.boost')
    T.truthy(submitted[1].measured.ratio > 1)
end)

T.test('airborne vehicles and non-ground types are skipped', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 200.0)
    sample({}, true) sample({}, true) sample({}, true)
    H.putInVehicle(1, 2, 200.0)
    sample() sample() sample()
    restore()
    T.eq(#submitted, 0)
end)

T.test('speed and model come from the server, not the report', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 20.0)
    H.advance(2000)
    H.fireNet(1, 'simpleac:vehicle:sample', { speed = 500.0, model = 1, fields = {} })
    restore()
    T.eq(#submitted, 0)
end)

T.test('passengers, grace windows and bad payloads are ignored', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 200.0)
    H.vehicles[1].driver = false
    sample({ fInitialDriveForce = 9.0 })
    H.vehicles[1].driver = true
    require('server-lua.detection.grace').grantJoin(1)
    sample({ fInitialDriveForce = 9.0 })
    H.advance(2000)
    H.fireNet(1, 'simpleac:vehicle:sample', 'nope')
    H.fireNet(1, 'simpleac:vehicle:sample', { fields = { fMass = 'x', evil = 1 } })
    restore()
    T.eq(#submitted, 0)
end)

T.test('rate-limits samples per player', function()
    local submitted, restore = setup()
    H.putInVehicle(1, ADDER, 20.0)
    H.advance(2000)
    for _ = 1, 10 do H.fireNet(1, 'simpleac:vehicle:sample', { fields = { fInitialDriveForce = 1.6 } }) end
    restore()
    T.eq(#submitted, 1)
end)

T.test('vehicle rules validate their measurements', function()
    local engine = require 'server-lua.detection.engine'
    H.addPlayer(1)
    local boost = engine.evaluate({ rule = 'vehicle.boost', source = 1,
        measured = { model = 'adder', speed = 90.0, ceiling = 60.0 } })
    T.eq(boost.accepted, true)
    local fake = engine.evaluate({ rule = 'vehicle.boost', source = 1,
        measured = { model = 'adder', speed = 10.0, ceiling = 60.0 } })
    T.eq(fake.accepted, false)
end)
