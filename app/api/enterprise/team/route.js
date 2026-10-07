/**
 * GET  /api/enterprise/team — list the org's team members (Admin/Owner only,
 *      per the approved matrix - team management is explicitly excluded
 *      from Manager/Viewer).
 * POST /api/enterprise/team — invite a new team member. Generates a real
 *      invite token now (Phase 5) - previously created a roster row with
 *      no way to ever actually log in.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseAdmin } from "@/lib/enterprise-permissions.js";
import { sendTeamInvite }      from "@/lib/email.js";
import { logAudit }            from "@/lib/audit.js";
import { v4 as uuid }          from "uuid";
import { z }                   from "zod";

const schema = z.object({
  name:  z.string().min(1).max(100),
  email: z.string().email(),
  role:  z.enum(["Owner","Admin","Manager","Viewer"]).default("Manager"),
  department: z.string().optional(),
});

// Found while rebuilding this route: this map used the old enterprise
// tier names (BUSINESS/PROFESSIONAL/ENTERPRISE), which the earlier rename
// changed to ENTERPRISE_BASIC/ENTERPRISE_PRO/ENTERPRISE_SCALE - meaning
// every org, regardless of actual plan, has been silently capped at the
// "?? 10" fallback since that rename shipped. Fixed.
const TEAM_LIMITS = { ENTERPRISE_BASIC: 10, ENTERPRISE_PRO: 50, ENTERPRISE_SCALE: Infinity };

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);

  const members = await prisma.enterpriseTeamMember.findMany({
    where:   { orgId: access.org.id },
    orderBy: { invitedAt: "desc" },
  });

  return ok({ members, yourRole: access.role });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  // Admin (not the true Owner) cannot grant Owner-level access to anyone -
  // matches "Admin = full access except billing and removing the Owner."
  if (data.role === "Owner" && access.role !== "Owner") {
    return err("Only the organization Owner can grant Owner-level access.", 403);
  }

  const limit = TEAM_LIMITS[org.plan] ?? 10;
  const currentCount = await prisma.enterpriseTeamMember.count({ where: { orgId: org.id } });
  if (currentCount >= limit) {
    return err(`Your plan allows up to ${limit} team members. Upgrade to add more.`, 403);
  }

  const existing = await prisma.enterpriseTeamMember.findUnique({
    where: { orgId_email: { orgId: org.id, email: data.email } },
  });
  if (existing) return err("This person is already on your team.", 409);

  const token = uuid();
  const member = await prisma.enterpriseTeamMember.create({
    data: {
      orgId: org.id, name: data.name, email: data.email, role: data.role, department: data.department || null,
      inviteToken: token, inviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  sendTeamInvite(member, org, auth.user.name, token).catch(() => {});

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "TEAM_MEMBER_INVITED",
    targetType: "EnterpriseTeamMember", targetId: member.id, orgId: org.id,
    category: "TEAM", metadata: { email: data.email, role: data.role },
  });

  return ok({ member, message: "Invite sent." }, 201);
}
