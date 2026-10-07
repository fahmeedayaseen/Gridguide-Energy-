/**
 * GET /api/enterprise/dashboard
 * Portfolio summary for the Enterprise Portal dashboard — properties,
 * devices, team, and current plan in one call.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err }             from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);

  const org = await prisma.enterpriseOrg.findUnique({
    where:   { id: access.org.id },
    include: {
      properties:  true,
      teamMembers: true,
    },
  });

  if (!org) return err("Enterprise organization not found", 404);

  const deviceCount = await prisma.device.count({
    where: { enterprisePropertyId: { in: org.properties.map(p => p.id) } },
  });

  const totalKw    = org.properties.reduce((a, p) => a + (p.kw || 0), 0);
  const totalUnits = org.properties.reduce((a, p) => a + (p.units || 0), 0);

  return ok({
    yourRole: access.role,
    org: {
      id: org.id, name: org.name, plan: org.plan,
      contactName: org.contactName, contactEmail: org.contactEmail, contactPhone: org.contactPhone,
      whiteLabelEnabled: org.whiteLabelEnabled, apiEnabled: org.apiEnabled,
    },
    summary: {
      propertyCount: org.properties.length,
      deviceCount,
      totalKw,
      totalUnits,
      teamCount: org.teamMembers.length,
    },
    properties: org.properties,
  });
}
