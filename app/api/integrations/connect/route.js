/**
 * GET  /api/integrations/connect?brand=nest|ecobee|honeywell|smartthings|alexa|sensi|derapi|apple
 * POST /api/integrations/connect   — credential-based brands (Sensi, Derapi)
 * DELETE /api/integrations/connect?brand=nest — disconnect brand
 */
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { getIntegration } from "@/lib/integrations.js";
import { redis } from "@/lib/redis.js";
import { prisma } from "@/lib/db.js";
import { awardDeviceConnectCredits } from "@/lib/credits.js";
import { z } from "zod";

const DEVICE_TYPES = ["SOLAR_INVERTER","BATTERY","EV_CHARGER","SMART_PANEL","THERMOSTAT","WATER_HEATER","SMART_PLUG","ENERGY_MONITOR"];

const credSchema = z.object({
  brand:        z.enum(["sensi","derapi","apple"]),
  username:     z.string().optional(),
  password:     z.string().optional(),
  apiKey:       z.string().optional(),
  pairingCode:  z.string().optional(),
  // What the homeowner actually selected in the connect UI (e.g. "SolarEdge"
  // under the Solar catalog section) — required for brand:"derapi" since,
  // unlike Sensi's getDevices() call, there is no real per-device discovery
  // against the Derapi API here yet (see note in POST below). Without this,
  // every Derapi connection previously defaulted to type "thermostat"
  // regardless of what the homeowner actually connected.
  deviceType:   z.enum(DEVICE_TYPES).optional(),
  manufacturer: z.string().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const brand = searchParams.get("brand");
  if (!brand) {
    // Return all available integrations with connection status
    const connected = await prisma.device.groupBy({
      by: ["brand"], where: { userId: auth.user.id }, _count: { brand: true },
    });
    return ok({ connected: connected.map(c => ({ brand: c.brand, count: c._count.brand })) });
  }

  const integration = getIntegration(brand);
  if (!integration) return err(`Unknown integration: ${brand}`, 404);

  if (["credentials","api_key","matter"].includes(integration.authType)) {
    const fieldMap = {
      credentials: ["username","password"],
      api_key:     ["apiKey"],
      matter:      ["pairingCode"],
    };
    return ok({ brand, requiresCredentials: true, fields: fieldMap[integration.authType], name: integration.name, description: integration.description });
  }

  // OAuth2 / LWA — generate auth URL
  const { state, url } = integration.getAuthUrl(auth.user.id);
  await redis.setEx(`oauth-state:${state}`, 600, JSON.stringify({ userId: auth.user.id, brand }));

  return ok({ brand, authUrl: url, state, name: integration.name });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, credSchema);
  if (error) return err("Validation failed", 400, error);

  try {
    const integration = getIntegration(data.brand);
    let accessToken = null, externalId = null, devices = [];

    if (data.brand === "sensi") {
      const tokens = await integration.connect(data.username, data.password);
      accessToken = tokens.accessToken;
      devices     = await integration.getDevices(tokens.accessToken, tokens.userId);
      externalId  = devices[0]?.id;
    } else if (data.brand === "derapi") {
      // NOTE: this does not yet call the real Derapi discovery API
      // (Derapi.getSystems / Derapi.getDevice in lib/integrations.js) to
      // find and type actual devices on the homeowner's account — it
      // trusts what the homeowner selected in the connect UI instead. Real
      // per-device discovery against Derapi's API is a separate, larger
      // piece of work (and needs live Derapi credentials to build against
      // safely) — flagged here rather than silently pretended to exist.
      if (!data.deviceType) {
        return err("deviceType is required when connecting a device via Derapi.", 400);
      }
      accessToken = data.apiKey;
      externalId  = `derapi-${Date.now()}`;
    } else if (data.brand === "apple") {
      const result = await integration.pairDevice(data.pairingCode);
      return ok({ message: "HomeKit pairing initiated", ...result });
    }

    const fallbackType = data.brand === "derapi" ? data.deviceType : "THERMOSTAT";
    const savedDevices = [];
    for (const device of devices.length ? devices : [{ id: externalId, type: fallbackType, name: data.manufacturer ? `${data.manufacturer} Device` : `${data.brand} Device` }]) {
      const saved = await prisma.device.upsert({
        where:  { externalId_userId: { externalId: device.id || externalId, userId: auth.user.id } },
        update: { brand: data.brand, accessToken, lastSyncAt: new Date() },
        create: { userId: auth.user.id, brand: data.brand, type: device.type || fallbackType, manufacturer: data.manufacturer || undefined, externalId: device.id || externalId, name: device.name, accessToken },
      });
      savedDevices.push(saved);

      // One-time 250-credit bonus per device. The rewardKey is keyed to Device.id
      // (the GridGuide DB row) so reconnects reuse the same key and are blocked
      // by the RewardGrant unique constraint — no double-pay on reconnect.
      await awardDeviceConnectCredits(auth.user.id, saved.id, saved.name || data.brand)
        .catch(e => console.error("[DeviceConnect] Credit award failed:", e.message));
    }

    return ok({ message: `${data.brand} connected`, brand: data.brand, deviceCount: savedDevices.length || 1 });
  } catch (e) {
    return err(`Connection failed: ${e.message}`, 502);
  }
}

export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const brand = searchParams.get("brand");
  if (!brand) return err("brand required", 400);

  const deleted = await prisma.device.deleteMany({ where: { userId: auth.user.id, brand } });
  return ok({ message: `${brand} disconnected`, removed: deleted.count });
}
