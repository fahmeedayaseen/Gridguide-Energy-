import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

/**
 * GET /api/devices/[id]/history?days=30 — a device's real telemetry
 * history, most recent first. Backed by DeviceReading, which only starts
 * accumulating rows from whenever a sync (cron poll or on-demand fetch)
 * actually succeeds for that device — there is no synthetic backfill, so a
 * freshly-connected device will legitimately return an empty array. Callers
 * (dashboards) must render that as "still building history," not as an
 * error or a fabricated flat line.
 */
export async function GET(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const device = await prisma.device.findUnique({ where: { id: params.id } });
  if (!device || device.userId !== auth.user.id) return err("Device not found", 404);

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "30", 10) || 30, 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const readings = await prisma.deviceReading.findMany({
    where: { deviceId: device.id, recordedAt: { gte: since } },
    orderBy: { recordedAt: "desc" },
    take: 500,
  });

  return ok({ deviceId: device.id, days, readings, count: readings.length });
}
