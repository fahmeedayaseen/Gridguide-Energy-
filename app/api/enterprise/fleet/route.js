/**
 * GET /api/enterprise/fleet — real device fleet across the org's properties,
 * grouped by device type. Uses Device.enterprisePropertyId, a real FK added
 * during the Utility Intelligence Module work earlier this session.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);

  const org = await prisma.enterpriseOrg.findUnique({
    where: { id: access.org.id },
    include: { properties: { select: { id: true, name: true } } },
  });
  if (!org) return err("Enterprise organization not found", 404);

  const propertyIds = org.properties.map((p) => p.id);
  const devices = propertyIds.length
    ? await prisma.device.findMany({
        where: { enterprisePropertyId: { in: propertyIds } },
        select: { id: true, type: true, brand: true, name: true, status: true, capacityKw: true, capacityKwh: true, lastSeenAt: true, enterprisePropertyId: true },
      })
    : [];

  const propertyNameById = Object.fromEntries(org.properties.map((p) => [p.id, p.name]));
  const byType = {};
  for (const d of devices) {
    byType[d.type] = byType[d.type] || { type: d.type, count: 0, online: 0, totalCapacityKw: 0 };
    byType[d.type].count++;
    if (d.status === "ACTIVE") byType[d.type].online++;
    byType[d.type].totalCapacityKw += d.capacityKw || 0;
  }

  return ok({
    devices: devices.map((d) => ({ ...d, propertyName: propertyNameById[d.enterprisePropertyId] || "Unassigned" })),
    summary: {
      total: devices.length,
      online: devices.filter((d) => d.status === "ACTIVE").length,
      byType: Object.values(byType),
    },
  });
}
