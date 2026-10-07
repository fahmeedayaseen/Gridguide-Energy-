/**
 * GET  /api/integrations/devices          — list all connected devices
 * POST /api/integrations/devices/command  — send command to a device
 */
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { prisma } from "@/lib/db.js";
import { getIntegration, getValidToken } from "@/lib/integrations.js";
import { z } from "zod";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type"); // optional filter

  const devices = await prisma.device.findMany({
    where:   { userId: auth.user.id, ...(type && { type }) },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, brand: true, type: true, name: true, externalId: true,
      capabilities: true, lastSyncAt: true,
      // Never return tokens to client
    },
  });

  const enhanced = devices.map(d => ({
    ...d,
    name:      d.name || `${d.brand} ${d.type.replace("_"," ")}`,
    connected: true,
    lastSync:  d.lastSyncAt ? Math.round((Date.now() - new Date(d.lastSyncAt)) / 60000) + "m ago" : "never",
  }));

  // Group by type for dashboard widget layout
  const grouped = {
    thermostats:     enhanced.filter(d => d.type === "thermostat"),
    batteries:       enhanced.filter(d => d.type === "battery"),
    solar:           enhanced.filter(d => d.type === "solar"),
    ev_chargers:     enhanced.filter(d => d.type === "ev_charger"),
    smart_plugs:     enhanced.filter(d => d.type === "smart_plug"),
    water_heaters:   enhanced.filter(d => d.type === "water_heater"),
    pool_pumps:      enhanced.filter(d => d.type === "pool_pump"),
    lights:          enhanced.filter(d => d.type === "light"),
    energy_monitors: enhanced.filter(d => d.type === "energy_monitor"),
    smart_breakers:  enhanced.filter(d => d.type === "smart_breaker"),
  };

  return ok({
    devices: enhanced,
    grouped,
    total:   enhanced.length,
    brands:  [...new Set(enhanced.map(d => d.brand))],
  });
}
