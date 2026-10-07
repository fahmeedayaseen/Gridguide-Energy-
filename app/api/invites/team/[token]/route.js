/**
 * GET /api/invites/team/[token] — public, unauthenticated lookup for the
 * team-invite landing page.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

export async function GET(request, { params }) {
  const member = await prisma.enterpriseTeamMember.findUnique({
    where: { inviteToken: params.token },
    include: { org: { select: { name: true } } },
  });
  if (!member) return err("Invitation not found.", 404);
  if (member.status !== "PENDING") return err(`This invitation has already been ${member.status === "ACTIVE" ? "accepted" : "revoked"}.`, 409);
  if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) return err("This invitation has expired.", 410);

  const existingUser = await prisma.user.findUnique({ where: { email: member.email }, select: { id: true } });

  return ok({
    invite: { email: member.email, orgName: member.org.name, role: member.role },
    accountExists: !!existingUser,
  });
}
