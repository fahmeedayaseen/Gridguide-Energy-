/**
 * GET /api/admin/enterprise-orgs — lightweight list for admin dropdowns
 * (e.g. scoping a VPP revenue-split rule to a specific org). Full org
 * management lives in app/api/enterprise/dashboard (self-service) — this
 * is intentionally minimal, not a general admin CRUD surface for orgs.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const orgs = await prisma.enterpriseOrg.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, plan: true, contactName: true, contactEmail: true, contactPhone: true, createdAt: true,
      _count: { select: { properties: true, teamMembers: true } },
    },
  });
  return ok({ orgs });
}
