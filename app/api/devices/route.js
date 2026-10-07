import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { cacheGet, cacheSet } from "@/lib/redis.js";
import { assertLimit } from "@/lib/memberships.js";
import { getEffectivePlanForUser } from "@/lib/effective-plan.js";
import { awardDeviceConnectCredits } from "@/lib/credits.js";
import axios from "axios";
import { z } from "zod";

const addDeviceSchema = z.object({
  type:         z.enum(["SOLAR_INVERTER","BATTERY","EV_CHARGER","SMART_PANEL","THERMOSTAT","WATER_HEATER","SMART_PLUG","ENERGY_MONITOR"]),
  manufacturer: z.string(),
  model:        z.string(),
  serialNumber: z.string().optional(),
  derApiId:     z.string().optional(), // Derapi device ID if already known
});

// GET /api/devices — list user's devices with live readings
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const devices = await prisma.device.findMany({
    where: { userId: auth.user.id },
    orderBy: { createdAt: "asc" },
  });

  // Enrich with live readings from Derapi
  const enriched = await Promise.all(
    devices.map(async (device) => {
      if (!device.derApiId) return { ...device, live: null };

      const cacheKey = `device:${device.id}:reading`;
      const cached   = await cacheGet(cacheKey);
      if (cached) return { ...device, live: cached };

      try {
        const res = await axios.get(
          `https://api.derapi.com/v1/devices/${device.derApiId}/telemetry`,
          { headers: { Authorization: `Bearer ${process.env.DERAPI_KEY}` }, timeout: 5000 }
        );
        const live = res.data;
        await cacheSet(cacheKey, live, 60); // 60s cache for live data
        await prisma.deviceReading.create({ data: { deviceId: device.id, reading: live } }).catch(() => {});
        return { ...device, live };
      } catch {
        return { ...device, live: null, warning: "Live data unavailable" };
      }
    })
  );

  return ok({ devices: enriched });
}

// POST /api/devices — add a new device
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, addDeviceSchema);
  if (error) return err("Validation failed", 400, error);

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { plan: true, _count: { select: { devices: true } } },
  });
  const effectivePlan = await getEffectivePlanForUser(auth.user.id);
  const limitCheck = assertLimit(effectivePlan || user?.plan, "devices", user?._count?.devices || 0, "Connected device");
  if (!limitCheck.allowed) return err(limitCheck.error, limitCheck.status, limitCheck);

  const device = await prisma.device.create({
    data: { userId: auth.user.id, ...data, status: "ACTIVE" },
  });

  // One-time 250-credit bonus for connecting a new device.
  // RewardGrant unique constraint on (userId, "device_connect:{device.id}")
  // ensures this never fires twice — delete + re-add = same Device.id = blocked.
  await awardDeviceConnectCredits(auth.user.id, device.id, device.name || data.manufacturer)
    .catch(e => console.error("[DeviceAdd] Credit award failed:", e.message));

  return ok({ device, message: "Device added. It will appear in your dashboard once synced." }, 201);
}

// DELETE /api/devices?id= — remove device
export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get("id");
  if (!deviceId) return err("Device ID required", 400);

  await prisma.device.deleteMany({
    where: { id: deviceId, userId: auth.user.id },
  });

  return ok({ message: "Device removed." });
}
