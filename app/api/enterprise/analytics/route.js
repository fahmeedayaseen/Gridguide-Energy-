/**
 * GET /api/enterprise/analytics — real current-snapshot portfolio analytics.
 *
 * This is deliberately NOT a time-series chart — there's no historical
 * telemetry aggregation table in this schema to build one from honestly.
 * Rather than fabricate a trend line, this reports real current totals:
 * capacity, utilization, and per-property breakdowns.
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
    include: { properties: true },
  });
  if (!org) return err("Enterprise organization not found", 404);

  const propertyIds = org.properties.map((p) => p.id);
  const devices = propertyIds.length
    ? await prisma.device.findMany({ where: { enterprisePropertyId: { in: propertyIds } } })
    : [];

  const totalCapacityKw = org.properties.reduce((a, p) => a + (p.kw || 0), 0);
  const activeProperties = org.properties.filter((p) => p.status === "active").length;
  const onlineDevices = devices.filter((d) => d.status === "ACTIVE").length;

  const perProperty = org.properties.map((p) => ({
    id: p.id,
    name: p.name,
    kw: p.kw,
    units: p.units,
    deviceCount: devices.filter((d) => d.enterprisePropertyId === p.id).length,
    status: p.status,
  }));

  return ok({
    summary: {
      totalProperties: org.properties.length,
      activeProperties,
      totalCapacityKw,
      totalDevices: devices.length,
      onlineDevices,
      utilizationPct: devices.length ? Math.round((onlineDevices / devices.length) * 100) : 0,
    },
    perProperty,
  });
}
