import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { cacheThermostatState, getThermostatState } from "@/lib/redis.js";
import { z } from "zod";
import axios from "axios";

const controlSchema = z.object({
  targetTemp: z.number().min(50).max(95).optional(),
  mode:       z.enum(["cool","heat","auto","off"]).optional(),
  aiOptimize: z.boolean().optional(),
  vppPreCondition: z.boolean().optional(),
  awayMode:   z.boolean().optional(),
  override:   z.boolean().optional(), // emergency override
});

// GET /api/thermostat/control — get current thermostat state
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  // Check Redis cache first (updated every 60s by background sync)
  const cached = await getThermostatState(auth.user.id);
  if (cached) return ok({ thermostat: cached, source: "cache" });

  const thermostat = await prisma.thermostat.findUnique({
    where: { userId: auth.user.id },
  });
  if (!thermostat) return err("No thermostat connected. Connect a device first.", 404);

  // Fetch live state from Derapi (recommended) or brand API
  const liveState = await fetchLiveThermostatState(thermostat);
  if (liveState.error) {
    // Fall back to DB state
    return ok({ thermostat, source: "db", warning: liveState.error });
  }

  // Update DB and cache
  const updated = await prisma.thermostat.update({
    where: { userId: auth.user.id },
    data: { ...liveState, lastSyncAt: new Date() },
  });
  await cacheThermostatState(auth.user.id, updated);

  return ok({ thermostat: updated, source: "live" });
}

// PATCH /api/thermostat/control — update thermostat settings
export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, controlSchema);
  if (error) return err("Validation failed", 400, error);

  const thermostat = await prisma.thermostat.findUnique({
    where: { userId: auth.user.id },
  });
  if (!thermostat) return err("No thermostat connected", 404);

  // If AI is optimizing, only allow changes if override is set
  if (thermostat.aiOptimize && !data.override && data.targetTemp) {
    return err("AI optimization is active. Enable override to manually control temperature.", 409);
  }

  // Send command to actual thermostat via API
  const commandResult = await sendThermostatCommand(thermostat, data);
  if (commandResult.error) {
    return err(`Thermostat command failed: ${commandResult.error}`, 502);
  }

  // Update DB
  const updated = await prisma.thermostat.update({
    where: { userId: auth.user.id },
    data: {
      ...data.targetTemp !== undefined  && { targetTemp: data.targetTemp },
      ...data.mode !== undefined        && { mode: data.mode },
      ...data.aiOptimize !== undefined  && { aiOptimize: data.aiOptimize },
      ...data.vppPreCondition !== undefined && { vppPreCondition: data.vppPreCondition },
      ...data.awayMode !== undefined    && { awayMode: data.awayMode },
      lastSyncAt: new Date(),
    },
  });

  // Invalidate cache so next GET fetches fresh
  await cacheThermostatState(auth.user.id, updated);

  return ok({ thermostat: updated, message: "Thermostat updated successfully." });
}

// ─── Brand API adapters ────────────────────────────────────────────────────────

async function fetchLiveThermostatState(thermostat) {
  try {
    switch (thermostat.brand) {
      case "derapi":
        return fetchViaDeraApi(thermostat);
      case "ecobee":
        return fetchViaEcobee(thermostat);
      case "nest":
        return fetchViaNest(thermostat);
      default:
        return fetchViaDeraApi(thermostat); // default to Derapi layer
    }
  } catch (err) {
    return { error: err.message };
  }
}

async function fetchViaDeraApi(thermostat) {
  const res = await axios.get(
    `https://api.derapi.com/v1/devices/${thermostat.externalId}/state`,
    { headers: { Authorization: `Bearer ${process.env.DERAPI_THERMOSTAT_KEY}` } }
  );
  const d = res.data;
  return {
    currentTemp: d.currentTemperature,
    targetTemp:  d.setpoint,
    humidity:    d.humidity,
    mode:        d.mode,
  };
}

async function fetchViaEcobee(thermostat) {
  const res = await axios.get(
    "https://api.ecobee.com/1/thermostat?format=json&body={\"selection\":{\"selectionType\":\"registered\",\"includeSensors\":true}}",
    { headers: { Authorization: `Bearer ${thermostat.accessToken}` } }
  );
  const t = res.data.thermostatList[0];
  const rt = t.runtime;
  return {
    currentTemp: rt.actualTemperature / 10,
    targetTemp:  rt.desiredCool / 10,
    humidity:    rt.actualHumidity,
    mode:        t.settings.hvacMode,
  };
}

async function fetchViaNest(thermostat) {
  const res = await axios.get(
    `https://smartdevicemanagement.googleapis.com/v1/enterprises/${process.env.GOOGLE_SDM_PROJECT_ID}/devices/${thermostat.externalId}`,
    { headers: { Authorization: `Bearer ${thermostat.accessToken}` } }
  );
  const traits = res.data.traits;
  return {
    currentTemp: traits["sdm.devices.traits.Temperature"]?.ambientTemperatureCelsius * 9/5 + 32,
    targetTemp:  traits["sdm.devices.traits.ThermostatTemperatureSetpoint"]?.coolCelsius * 9/5 + 32,
    humidity:    traits["sdm.devices.traits.Humidity"]?.ambientHumidityPercent,
    mode:        traits["sdm.devices.traits.ThermostatMode"]?.mode?.toLowerCase(),
  };
}

async function sendThermostatCommand(thermostat, command) {
  try {
    switch (thermostat.brand) {
      case "derapi":
      case "default": {
        await axios.post(
          `https://api.derapi.com/v1/devices/${thermostat.externalId}/command`,
          {
            ...(command.targetTemp && { setpoint: command.targetTemp }),
            ...(command.mode && { mode: command.mode }),
          },
          { headers: { Authorization: `Bearer ${process.env.DERAPI_THERMOSTAT_KEY}` } }
        );
        return { success: true };
      }
      case "ecobee": {
        await axios.post(
          "https://api.ecobee.com/1/thermostat?format=json",
          {
            selection: { selectionType: "registered" },
            thermostat: {
              settings: command.mode ? { hvacMode: command.mode } : undefined,
            },
            functions: command.targetTemp ? [{
              type: "setHold",
              params: {
                coolHoldTemp: command.targetTemp * 10,
                heatHoldTemp: (command.targetTemp - 3) * 10,
                holdType: "nextTransition",
              },
            }] : undefined,
          },
          { headers: { Authorization: `Bearer ${thermostat.accessToken}` } }
        );
        return { success: true };
      }
      default:
        return { error: "Unsupported thermostat brand" };
    }
  } catch (err) {
    return { error: err.response?.data?.error || err.message };
  }
}
