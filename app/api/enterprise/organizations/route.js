/**
 * DEPRECATED as of 2026-07-04 — see ENTERPRISE_ARCHITECTURE_DECISION.md.
 * `EnterpriseOrg` (app/api/enterprise/dashboard, /properties, /team) is the
 * primary model backing the live Enterprise Portal. This route operates on
 * the separate `Organization` model, which has no frontend consumer.
 * Kept functional (not removed) pending a production row-count check —
 * do not build new features against this route or model.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseAccess, slugifyOrganizationName, enterpriseSummary } from "@/lib/enterprise.js";
import { z } from "zod";

const createSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(["HOMEOWNER", "PROPERTY_MANAGER", "COMMERCIAL", "UTILITY", "PARTNER"]).optional().default("HOMEOWNER"),
  seatsLimit: z.number().int().positive().nullable().optional(),
  propertyLimit: z.number().int().positive().nullable().optional(),
  apiEnabled: z.boolean().optional().default(true),
  whiteLabelEnabled: z.boolean().optional().default(false),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const organizations = await prisma.organization.findMany({
    where: { members: { some: { userId: auth.user.id, status: "ACTIVE" } } },
    include: { _count: { select: { members: true, properties: true, utilityAccounts: true, vppPrograms: true } } },
    orderBy: { createdAt: "desc" },
  });
  return ok({ organizations: organizations.map(enterpriseSummary) });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const enterprise = await requireEnterpriseAccess(auth.user.id);
  if (!enterprise.allowed) return err(enterprise.error, enterprise.status, enterprise);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const baseSlug = slugifyOrganizationName(data.name);
  const slug = `${baseSlug}-${String(Date.now()).slice(-5)}`;
  const organization = await prisma.organization.create({
    data: {
      name: data.name,
      slug,
      type: data.type,
      ownerId: auth.user.id,
      plan: "HOMEOWNER_PREMIUM",
      seatsLimit: data.seatsLimit ?? null,
      propertyLimit: data.propertyLimit ?? null,
      apiEnabled: data.apiEnabled,
      whiteLabelEnabled: data.whiteLabelEnabled,
      members: { create: { userId: auth.user.id, role: "OWNER", status: "ACTIVE", joinedAt: new Date() } },
    },
    include: { _count: { select: { members: true, properties: true, utilityAccounts: true, vppPrograms: true } } },
  });

  return ok({ organization: enterpriseSummary(organization), message: "Enterprise organization created." }, 201);
}
