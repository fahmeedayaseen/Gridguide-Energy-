/**
 * GridGuide — Integrations Hub
 *
 * Priority integration stack covering ~85% of US residential energy market:
 *
 * THERMOSTATS
 *   Google Nest (SDM API)     — #1 premium smart thermostat
 *   Ecobee                    — #1 utility demand response partner
 *   Honeywell Home            — largest installed base
 *   Emerson Sensi             — affordable, utility-friendly
 *
 * SMART HOME ECOSYSTEMS
 *   Samsung SmartThings       — 200M+ connected devices, Matter hub
 *   Amazon Alexa (Alexa Smart Home API) — 100M+ devices
 *   Apple HomeKit (MatterJS)  — high-income homeowner segment
 *
 * SOLAR / BATTERY / EV (via Derapi normalized layer)
 *   SolarEdge, Enphase, SMA, Fronius
 *   Tesla Powerwall, Enphase IQ Battery, LG RESU, Sonnen
 *   ChargePoint, Wallbox, JuiceBox, Tesla Wall Connector
 *
 * DEVICE TYPES GridGuide Can Control
 *   Thermostats, EV chargers, Smart plugs, Water heaters,
 *   Pool pumps, Home batteries, Solar systems,
 *   Smart breakers (Span, Lumin), Lighting systems
 */

import axios from "axios";
import { redis } from "./redis.js";
import { logger } from "./sentry.js";

// ─── OAuth redirect base URL ───────────────────────────────────────────────────
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
const CB      = `${APP_URL}/api/integrations/callback`;

// ─── 1. GOOGLE NEST (Smart Device Management API) ─────────────────────────────
export const GoogleNest = {
  name: "Google Nest",
  category: "thermostat",
  icon: "nest",
  description: "Control Nest thermostats, cameras, and doorbells via Google Smart Device Management API.",
  devices: ["Nest Thermostat", "Nest Thermostat E", "Nest Learning Thermostat"],
  authType: "oauth2",

  getAuthUrl(userId) {
    const state = `${userId}:${Date.now()}:nest`;
    return {
      state,
      url: `https://nestservices.google.com/partnerconnections/${process.env.GOOGLE_SDM_PROJECT_ID}/auth` +
        `?redirect_uri=${CB}&access_type=offline&prompt=consent` +
        `&client_id=${process.env.GOOGLE_SDM_CLIENT_ID}` +
        `&response_type=code` +
        `&scope=https://www.googleapis.com/auth/sdm.service`,
    };
  },

  async exchangeCode(code) {
    const res = await axios.post("https://oauth2.googleapis.com/token", {
      code,
      client_id:     process.env.GOOGLE_SDM_CLIENT_ID,
      client_secret: process.env.GOOGLE_SDM_SECRET,
      redirect_uri:  CB,
      grant_type:    "authorization_code",
    });
    return { accessToken: res.data.access_token, refreshToken: res.data.refresh_token, expiresIn: res.data.expires_in };
  },

  async refreshToken(refreshToken) {
    const res = await axios.post("https://oauth2.googleapis.com/token", {
      client_id:     process.env.GOOGLE_SDM_CLIENT_ID,
      client_secret: process.env.GOOGLE_SDM_SECRET,
      refresh_token: refreshToken,
      grant_type:    "refresh_token",
    });
    return { accessToken: res.data.access_token, expiresIn: res.data.expires_in };
  },

  async getDevices(accessToken) {
    const res = await axios.get(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_SDM_PROJECT_ID}/devices`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return (res.data.devices || []).map(d => ({
      id:          d.name.split("/").pop(),
      name:        d.displayName || "Nest Thermostat",
      type:        "thermostat",
      traits:      Object.keys(d.traits || {}),
      currentTemp: d.traits?.["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius,
      targetTemp:  d.traits?.["sdm.devices.traits.ThermostatTemperatureSetpoint"]?.heatCelsius,
      mode:        d.traits?.["sdm.devices.traits.ThermostatMode"]?.mode,
    }));
  },

  async setTemperature(accessToken, deviceId, heatCelsius, coolCelsius) {
    return axios.post(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_SDM_PROJECT_ID}/devices/${deviceId}:executeCommand`,
      { command: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange", params: { heatCelsius, coolCelsius } },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
  },

  async setMode(accessToken, deviceId, mode) {
    // mode: HEAT | COOL | HEATCOOL | OFF
    return axios.post(
      `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_SDM_PROJECT_ID}/devices/${deviceId}:executeCommand`,
      { command: "sdm.devices.commands.ThermostatMode.SetMode", params: { mode } },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
  },
};

// ─── 2. ECOBEE ────────────────────────────────────────────────────────────────
export const Ecobee = {
  name: "Ecobee",
  category: "thermostat",
  icon: "ecobee",
  description: "Premium smart thermostats with built-in VPP demand response. Used by 250+ utilities.",
  devices: ["ecobee SmartThermostat Premium", "SmartThermostat Enhanced", "ecobee3 lite"],
  authType: "oauth2",

  getAuthUrl(userId) {
    const state = `${userId}:${Date.now()}:ecobee`;
    return {
      state,
      url: `https://api.ecobee.com/authorize?response_type=code&client_id=${process.env.ECOBEE_CLIENT_ID}&redirect_uri=${CB}&scope=smartWrite&state=${state}`,
    };
  },

  async exchangeCode(code) {
    const res = await axios.post("https://api.ecobee.com/token", null, {
      params: { grant_type: "authorization_code", code, redirect_uri: CB, client_id: process.env.ECOBEE_CLIENT_ID },
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    return { accessToken: res.data.access_token, refreshToken: res.data.refresh_token, expiresIn: res.data.expires_in };
  },

  async refreshToken(refreshToken) {
    const res = await axios.post("https://api.ecobee.com/token", null, {
      params: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: process.env.ECOBEE_CLIENT_ID },
    });
    return { accessToken: res.data.access_token, refreshToken: res.data.refresh_token, expiresIn: res.data.expires_in };
  },

  async getDevices(accessToken) {
    const body = JSON.stringify({ selection: { selectionType: "registered", selectionMatch: "", includeRuntime: true, includeSensors: true } });
    const res  = await axios.get(`https://api.ecobee.com/1/thermostat?format=json&body=${encodeURIComponent(body)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return (res.data.thermostatList || []).map(t => ({
      id:          t.identifier,
      name:        t.name,
      type:        "thermostat",
      currentTemp: t.runtime?.actualTemperature / 10,
      targetHeat:  t.runtime?.desiredHeat / 10,
      targetCool:  t.runtime?.desiredCool / 10,
      mode:        t.settings?.hvacMode,
      humidity:    t.runtime?.actualHumidity,
    }));
  },

  async setTemperature(accessToken, thermostatId, heatF, coolF) {
    const body = {
      selection:   { selectionType: "thermostats", selectionMatch: thermostatId },
      thermostat:  { settings: { hvacMode: "auto" } },
      functions:   [{ type: "setHold", params: { holdType: "nextTransition", heatHoldTemp: Math.round(heatF * 10), coolHoldTemp: Math.round(coolF * 10) } }],
    };
    return axios.post("https://api.ecobee.com/1/thermostat?format=json", body, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
  },

  // Ecobee-specific: demand response hold (used for VPP events)
  async setDemandResponseHold(accessToken, thermostatId, durationMinutes, heatAdjustF = 4, coolAdjustF = 4) {
    const body = {
      selection: { selectionType: "thermostats", selectionMatch: thermostatId },
      functions: [{
        type:   "setHold",
        params: {
          holdType:       "holdHours",
          holdHours:      Math.ceil(durationMinutes / 60),
          heatHoldTemp:   -1,   // Use existing target minus adjustment
          coolHoldTemp:   -1,
          heatDeltaTemp:  Math.round(-heatAdjustF * 10),  // Back off heating
          coolDeltaTemp:  Math.round(coolAdjustF * 10),   // Raise cooling setpoint
        },
      }],
    };
    return axios.post("https://api.ecobee.com/1/thermostat?format=json", body, {
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
  },
};

// ─── 3. HONEYWELL HOME / RESIDEO ──────────────────────────────────────────────
export const HoneywellHome = {
  name: "Honeywell Home",
  category: "thermostat",
  icon: "honeywell",
  description: "Connect T-Series and Lyric thermostats via the Resideo/Honeywell Home API.",
  devices: ["T9", "T10 Pro", "T6 Pro", "Lyric Round", "RTH9585"],
  authType: "oauth2",

  getAuthUrl(userId) {
    const state = `${userId}:${Date.now()}:honeywell`;
    return {
      state,
      url: `https://api.honeywellhome.com/oauth2/authorize?response_type=code&redirect_uri=${CB}&client_id=${process.env.HONEYWELL_CONSUMER_KEY}&state=${state}`,
    };
  },

  async exchangeCode(code) {
    const res = await axios.post("https://api.honeywellhome.com/oauth2/token",
      `grant_type=authorization_code&code=${code}&redirect_uri=${CB}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${process.env.HONEYWELL_CONSUMER_KEY}:${process.env.HONEYWELL_CONSUMER_SECRET}`).toString("base64")}` } }
    );
    return { accessToken: res.data.access_token, refreshToken: res.data.refresh_token, expiresIn: res.data.expires_in };
  },

  async getDevices(accessToken) {
    const locRes = await axios.get(`https://api.honeywellhome.com/v2/locations?apikey=${process.env.HONEYWELL_CONSUMER_KEY}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const devices = [];
    for (const loc of locRes.data || []) {
      for (const dev of loc.devices || []) {
        devices.push({
          id:          dev.deviceID,
          locationId:  loc.locationID,
          name:        dev.userDefinedDeviceName || "Honeywell Thermostat",
          type:        "thermostat",
          currentTemp: dev.indoorTemperature,
          targetHeat:  dev.changeableValues?.heatSetpoint,
          targetCool:  dev.changeableValues?.coolSetpoint,
          mode:        dev.changeableValues?.mode,
          humidity:    dev.indoorHumidity,
        });
      }
    }
    return devices;
  },

  async setTemperature(accessToken, deviceId, locationId, heatSetpoint, coolSetpoint) {
    return axios.post(
      `https://api.honeywellhome.com/v2/devices/thermostats/${deviceId}?apikey=${process.env.HONEYWELL_CONSUMER_KEY}&locationId=${locationId}`,
      { mode: "Auto", heatSetpoint, coolSetpoint },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
  },
};

// ─── 4. SAMSUNG SMARTTHINGS ───────────────────────────────────────────────────
export const SamsungSmartThings = {
  name: "Samsung SmartThings",
  category: "ecosystem",
  icon: "smartthings",
  description: "Access 200M+ connected devices — thermostats, smart plugs, water heaters, pool pumps, and more — through one SmartThings API.",
  devices: ["Thermostats", "Smart Plugs", "Water Heaters", "EV Chargers", "Lighting", "Sensors", "Pool Controllers"],
  authType: "oauth2",
  // SmartThings uses PAT (Personal Access Token) or OAuth
  // PAT is simplest — user creates in SmartThings app

  getAuthUrl(userId) {
    // SmartThings OAuth2
    const state = `${userId}:${Date.now()}:smartthings`;
    return {
      state,
      url: `https://api.smartthings.com/oauth/authorize?client_id=${process.env.SMARTTHINGS_CLIENT_ID}&scope=r:devices:*+x:devices:*+r:locations:*&response_type=code&redirect_uri=${CB}&state=${state}`,
    };
  },

  async exchangeCode(code) {
    const res = await axios.post("https://api.smartthings.com/oauth/token",
      `grant_type=authorization_code&code=${code}&redirect_uri=${CB}&client_id=${process.env.SMARTTHINGS_CLIENT_ID}&client_secret=${process.env.SMARTTHINGS_CLIENT_SECRET}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return { accessToken: res.data.access_token, refreshToken: res.data.refresh_token, expiresIn: res.data.expires_in };
  },

  async getDevices(accessToken, category = null) {
    const res = await axios.get("https://api.smartthings.com/v1/devices", {
      headers: { Authorization: `Bearer ${accessToken}` },
      params:  category ? { capability: category } : {},
    });

    return (res.data.items || []).map(d => ({
      id:           d.deviceId,
      name:         d.label || d.name,
      type:         mapSmartThingsCategory(d.components?.[0]?.categories?.[0]?.name),
      manufacturer: d.manufacturerName,
      model:        d.deviceManufacturerCode,
      roomId:       d.roomId,
      locationId:   d.locationId,
      capabilities: d.components?.flatMap(c => c.capabilities?.map(cap => cap.id)) || [],
    }));
  },

  async executeCommand(accessToken, deviceId, capability, command, args = []) {
    return axios.post(
      `https://api.smartthings.com/v1/devices/${deviceId}/commands`,
      { commands: [{ component: "main", capability, command, arguments: args }] },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
  },

  // Convenience: set thermostat temperature
  async setThermostatTemp(accessToken, deviceId, heatSetpoint, coolSetpoint, unit = "F") {
    await SamsungSmartThings.executeCommand(accessToken, deviceId, "thermostatHeatingSetpoint", "setHeatingSetpoint", [heatSetpoint]);
    await SamsungSmartThings.executeCommand(accessToken, deviceId, "thermostatCoolingSetpoint", "setCoolingSetpoint", [coolSetpoint]);
  },

  // Control smart plugs (water heaters, pool pumps)
  async setSwitch(accessToken, deviceId, onOff) {
    return SamsungSmartThings.executeCommand(accessToken, deviceId, "switch", onOff === "on" ? "on" : "off");
  },

  // EV charger control
  async setEVCharger(accessToken, deviceId, enable) {
    return SamsungSmartThings.executeCommand(accessToken, deviceId, "powerConsumptionReport", enable ? "start" : "stop");
  },
};

// ─── 5. AMAZON ALEXA SMART HOME ───────────────────────────────────────────────
export const AmazonAlexa = {
  name: "Amazon Alexa",
  category: "ecosystem",
  icon: "alexa",
  description: "Control thermostats, smart plugs, lights, and 100,000+ Alexa-compatible energy devices.",
  devices: ["Thermostats", "Smart Plugs", "EV Chargers", "Lighting", "Energy Monitors"],
  authType: "lwa", // Login with Amazon
  // Note: Alexa Smart Home Skill requires Alexa Skill Kit registration
  // GridGuide publishes a "GridGuide Skill" in Alexa Skill Store

  getAuthUrl(userId) {
    const state = `${userId}:${Date.now()}:alexa`;
    return {
      state,
      // Login with Amazon (LWA) OAuth
      url: `https://www.amazon.com/ap/oa?client_id=${process.env.AMAZON_LWA_CLIENT_ID}&scope=alexa::smart_home&response_type=code&redirect_uri=${CB}&state=${state}`,
    };
  },

  async exchangeCode(code) {
    const res = await axios.post("https://api.amazon.com/auth/o2/token",
      `grant_type=authorization_code&code=${code}&redirect_uri=${CB}&client_id=${process.env.AMAZON_LWA_CLIENT_ID}&client_secret=${process.env.AMAZON_LWA_CLIENT_SECRET}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return { accessToken: res.data.access_token, refreshToken: res.data.refresh_token, expiresIn: res.data.expires_in };
  },

  // Alexa Smart Home Skill Proactive State Reporting
  // GridGuide sends commands via Alexa Smart Home Skill events
  async sendDirective(accessToken, endpointId, namespace, name, payload = {}) {
    return axios.post("https://api.amazonalexa.com/v3/events",
      {
        event: {
          header:   { namespace, name, messageId: crypto.randomUUID(), payloadVersion: "3" },
          endpoint: { scope: { type: "BearerToken", token: accessToken }, endpointId },
          payload,
        },
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
  },

  async setThermostat(accessToken, endpointId, targetTempF, mode = "AUTO") {
    return AmazonAlexa.sendDirective(accessToken, endpointId, "Alexa.ThermostatController", "SetTargetTemperature", {
      targetSetpoint:  { value: (targetTempF - 32) * 5 / 9, scale: "CELSIUS" },
      thermostatMode:  { value: mode },
    });
  },

  async setSmartPlug(accessToken, endpointId, on) {
    return AmazonAlexa.sendDirective(accessToken, endpointId, "Alexa.PowerController", on ? "TurnOn" : "TurnOff");
  },
};

// ─── 6. APPLE HOMEKIT (via Matter.js) ─────────────────────────────────────────
export const AppleHomeKit = {
  name: "Apple HomeKit",
  category: "ecosystem",
  icon: "apple",
  description: "Connect to HomeKit-compatible devices via Matter protocol. Targets high-income homeowners with premium smart home setups.",
  devices: ["Thermostats", "Smart Plugs", "EV Chargers (Matter)", "Lighting", "Energy Monitors"],
  authType: "matter",
  // HomeKit integration uses Matter protocol (open standard)
  // Apple requires MFi certification for HomeKit Accessory Protocol (HAP)
  // GridGuide registers as a Matter controller via Matter.js / node-matter

  async pairDevice(pairingCode) {
    // Matter pairing — use node-matter or matter-node.js SDK
    // pairingCode: 11-digit pairing code on the device
    // In production: use @project-chip/matter-node.js
    return {
      paired: true,
      message: "Matter pairing initiated. Scan QR code on device or enter pairing code.",
      pairingCode,
      // commission: await matterController.commission(pairingCode)
    };
  },

  // Note: Full HomeKit/Matter integration requires:
  // 1. Apple MFi license (for HAP devices, optional for Matter)
  // 2. node-matter or @project-chip/matter-node.js
  // 3. Local network access to device hub
  // GridGuide can act as a Matter controller bridge
};

// ─── 7. EMERSON SENSI ─────────────────────────────────────────────────────────
export const EmersonSensi = {
  name: "Emerson Sensi",
  category: "thermostat",
  icon: "sensi",
  description: "Affordable smart thermostats popular in utility rebate programs.",
  devices: ["Sensi Touch", "Sensi Touch 2", "Sensi Classic", "Sensi Lite"],
  authType: "credentials",

  async connect(username, password) {
    const res = await axios.post("https://web.sensicomfort.com/api/authorize/token",
      { username, password, grant_type: "password" },
      { headers: { "Content-Type": "application/json" } }
    );
    return { accessToken: res.data.access_token, userId: res.data.user?.userId };
  },

  async getDevices(accessToken, sensiUserId) {
    const res = await axios.get(`https://web.sensicomfort.com/api/thermostats?userId=${sensiUserId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return (res.data || []).map(t => ({
      id:          t.ICD,
      name:        t.name || "Sensi Thermostat",
      type:        "thermostat",
      currentTemp: t.currentTemperature,
      targetHeat:  t.setpoints?.heat,
      targetCool:  t.setpoints?.cool,
      mode:        t.systemMode,
    }));
  },

  async setTemperature(accessToken, icd, heatSetpoint, coolSetpoint, mode = "auto") {
    return axios.put(`https://web.sensicomfort.com/api/thermostats/${icd}/setpoints`,
      { heat: heatSetpoint, cool: coolSetpoint, mode },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
  },
};

// ─── 8. DERAPI (Normalized DER layer — covers 40+ brands) ─────────────────────
export const Derapi = {
  name: "Derapi",
  category: "der",
  icon: "derapi",
  description: "One API for all DER devices — solar inverters, batteries, EVs, thermostats across 40+ brands.",
  authType: "api_key",

  headers() {
    return { Authorization: `Bearer ${process.env.DERAPI_KEY}`, "Content-Type": "application/json" };
  },

  async getSystems(userId) {
    const res = await axios.get(`https://api.derapi.com/v1/systems?userId=${userId}`, { headers: this.headers() });
    return res.data.systems || [];
  },

  async getDevice(systemId, deviceType) {
    const res = await axios.get(`https://api.derapi.com/v1/systems/${systemId}/devices?type=${deviceType}`, { headers: this.headers() });
    return res.data;
  },

  async dispatchBattery(systemId, powerKw, durationMinutes) {
    return axios.post(`https://api.derapi.com/v1/systems/${systemId}/battery/dispatch`,
      { powerKw, durationMinutes, mode: "discharge" },
      { headers: this.headers() }
    );
  },

  async setEVChargingRate(systemId, rateAmps) {
    return axios.post(`https://api.derapi.com/v1/systems/${systemId}/ev/charge-rate`,
      { rateAmps },
      { headers: this.headers() }
    );
  },

  async setWaterHeaterMode(systemId, mode) {
    // mode: eco | heat_pump | high_demand | vacation
    return axios.post(`https://api.derapi.com/v1/systems/${systemId}/water_heater/mode`,
      { mode },
      { headers: this.headers() }
    );
  },

  async setPoolPumpSchedule(systemId, schedule) {
    return axios.post(`https://api.derapi.com/v1/systems/${systemId}/pool/schedule`,
      { schedule },
      { headers: this.headers() }
    );
  },
};

// ─── INTEGRATION REGISTRY ─────────────────────────────────────────────────────
export const INTEGRATIONS = {
  // Thermostats
  nest:         { ...GoogleNest,       key: "nest"         },
  ecobee:       { ...Ecobee,           key: "ecobee"       },
  honeywell:    { ...HoneywellHome,    key: "honeywell"    },
  sensi:        { ...EmersonSensi,     key: "sensi"        },
  // Ecosystems
  smartthings:  { ...SamsungSmartThings, key: "smartthings" },
  alexa:        { ...AmazonAlexa,      key: "alexa"        },
  apple:        { ...AppleHomeKit,     key: "apple"        },
  // DER platform
  derapi:       { ...Derapi,           key: "derapi"       },
};

export function getIntegration(key) {
  return INTEGRATIONS[key] || null;
}

// ─── DEVICE TYPE MAPPER ───────────────────────────────────────────────────────
function mapSmartThingsCategory(stCategory) {
  const map = {
    "Thermostat":      "thermostat",
    "SmartPlug":       "smart_plug",
    "Switch":          "smart_plug",
    "EnergyMeter":     "energy_monitor",
    "Light":           "light",
    "EVCharger":       "ev_charger",
    "WaterHeater":     "water_heater",
    "PoolController":  "pool_pump",
    "AirConditioner":  "thermostat",
    "Hub":             "hub",
  };
  return map[stCategory] || "device";
}

// ─── TOKEN REFRESH HELPER ─────────────────────────────────────────────────────
export async function getValidToken(thermostat) {
  const { brand, accessToken, refreshToken, tokenExpiresAt } = thermostat;
  const integration = getIntegration(brand);
  if (!integration || !integration.refreshToken) return accessToken;

  // If token expires in < 5 minutes, refresh it
  if (tokenExpiresAt && new Date(tokenExpiresAt) < new Date(Date.now() + 5 * 60_000)) {
    try {
      const refreshed = await integration.refreshToken(refreshToken);
      return refreshed.accessToken;
    } catch {
      logger.error(`Token refresh failed for ${brand}`);
      return accessToken;
    }
  }
  return accessToken;
}
