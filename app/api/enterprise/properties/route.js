/**
 * GET  /api/enterprise/properties — list the logged-in org's properties
 * POST /api/enterprise/properties — add a new property
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { logAudit }            from "@/lib/audit.js";
import { z }                   from "zod";

const schema = z.object({
  name:    z.string().min(1).max(150),
  address: z.string().optional(),
  type:    z.enum(["Residential","Commercial","Mixed-Use","HOA","Municipal","School/Institution"]).default("Residential"),
  units:   z.union([z.string(), z.number()]).optional(),
  kw:      z.union([z.string(), z.number()]).optional(),
});

// Same stale-tier-name bug found in team limits: this used the old
// BUSINESS/PROFESSIONAL/ENTERPRISE names, meaning every org has been
// silently capped at the "?? 5" fallback since the tier rename shipped.
const PROPERTY_LIMITS = { ENTERPRISE_BASIC: 5, ENTERPRISE_PRO: 25, ENTERPRISE_SCALE: Infinity };

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);

  const properties = await prisma.enterpriseProperty.findMany({
    where:   { orgId: access.org.id },
    orderBy: { createdAt: "desc" },
  });

  return ok({ properties, yourRole: access.role });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const limit = PROPERTY_LIMITS[org.plan] ?? 5;
  const currentCount = await prisma.enterpriseProperty.count({ where: { orgId: org.id } });
  if (currentCount >= limit) {
    return err(`Your plan allows up to ${limit} properties. Upgrade to add more.`, 403);
  }

  const property = await prisma.enterpriseProperty.create({
    data: {
      orgId:  org.id,
      name:   data.name,
      address: data.address || null,
      type:   data.type,
      units:  data.units ? parseInt(data.units, 10) : 0,
      kw:     data.kw ? parseFloat(data.kw) : 0,
      status: "pending",
    },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "PROPERTY_ADDED",
    targetType: "EnterpriseProperty", targetId: property.id, orgId: org.id,
    category: "ASSIGNMENT", metadata: { name: property.name },
  });

  return ok({ property, message: "Property added." }, 201);
}
