// Run with: node --import ./tests/helpers/register-alias.mjs --test tests/device-type.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { mapDeviceType, DEVICE_TYPES } = await import("../lib/integrations.js");
const sync = await import("../lib/integration-sync.js"); // used to throw: mapDeviceType was never defined

test("integration-sync loads", () => {
  assert.equal(typeof sync.saveProviderDevices, "function");
});

test("maps provider type strings to the Device.type vocabulary", () => {
  const cases = {
    thermostat: "thermostat", Thermostat: "thermostat", EVCharger: "ev_charger", "ev-charger": "ev_charger",
    SOLAR_INVERTER: "solar", inverter: "solar", Powerwall: "battery", SmartPlug: "smart_plug",
    "energy meter": "energy_monitor", gateway: "hub",
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(mapDeviceType(input), expected, input);
});

test("unknown or empty input falls back to 'device', always a known type", () => {
  for (const v of ["", null, undefined, "toaster", 42]) {
    const t = mapDeviceType(v);
    assert.equal(t, "device");
    assert.ok(DEVICE_TYPES.includes(t));
  }
});
