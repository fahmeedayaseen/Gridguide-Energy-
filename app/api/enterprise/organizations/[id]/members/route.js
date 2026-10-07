// DEPRECATED as of 2026-07-04 — see ENTERPRISE_ARCHITECTURE_DECISION.md.
// Operates on the deprecated `Organization`/`OrganizationMember` models.
// Use app/api/enterprise/team (EnterpriseTeamMember) instead.
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireOrganizationRole } from "@/lib/enterprise.js";
import { z } from "zod";

const memberSchema = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "MANAGER", "MEMBER", "VIEWER"]).optional().default("MEMBER"),
}).refine((v) => v.userId || v.email, { message: "userId or email is required" });

export async function GET(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireOrganizationRole(auth.user.id, params.id, ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"]);
  if (!access.allowed) return err(access.error, access.status);

  const members = await prisma.organizationMember.findMany({
    where: { organizationId: params.id },
    include: { user: { select: { id: true, name: true, email: true, role: true, plan: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok({ members });
}

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireOrganizationRole(auth.user.id, params.id, ["OWNER", "ADMIN"]);
  if (!access.allowed) return err(access.error, access.status);

  const { data, error } = await parseBody(request, memberSchema);
  if (error) return err("Validation failed", 400, error);

  let user = null;
  if (data.userId) user = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!user && data.email) user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (!user) return err("User must register before being added to an organization.", 404);

  const member = await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: params.id, userId: user.id } },
    create: { organizationId: params.id, userId: user.id, role: data.role, status: "ACTIVE", invitedEmail: data.email, joinedAt: new Date() },
    update: { role: data.role, status: "ACTIVE" },
    include: { user: { select: { id: true, name: true, email: true, role: true, plan: true } } },
  });
  return ok({ member, message: "Organization member saved." }, 201);
}
