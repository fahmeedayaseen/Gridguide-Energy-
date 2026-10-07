/**
 * DELETE /api/enterprise/team/[id] — revoke a team member's access.
 * Soft-revoke: sets status to REVOKED and clears userId so they can no
 * longer authenticate as this org, without deleting the audit history.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseAdmin } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";

export async function DELETE(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);

  const member = await prisma.enterpriseTeamMember.findUnique({ where: { id: params.id } });
  if (!member || member.orgId !== access.org.id) return err("Team member not found", 404);

  // Admin (not the true Owner) cannot revoke the Owner.
  if (member.role === "Owner" && access.role !== "Owner") {
    return err("Only the organization Owner can revoke Owner-level access.", 403);
  }

  const updated = await prisma.enterpriseTeamMember.update({
    where: { id: member.id },
    data: { status: "REVOKED", userId: null },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "TEAM_MEMBER_REVOKED",
    targetType: "EnterpriseTeamMember", targetId: member.id, orgId: access.org.id,
    category: "TEAM", metadata: { email: member.email, role: member.role },
  });

  return ok({ member: updated, message: "Access revoked." });
}
