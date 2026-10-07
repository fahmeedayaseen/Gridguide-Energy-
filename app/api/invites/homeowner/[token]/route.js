/**
 * GET /api/invites/homeowner/[token] — public, unauthenticated lookup so
 * the accept/decline landing page can render the inviting org's name
 * before the visitor logs in or creates an account.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

export async function GET(request, { params }) {
  const invite = await prisma.enterpriseHomeownerInvite.findUnique({
    where: { token: params.token },
    include: { org: { select: { name: true } } },
  });
  if (!invite) return err("Invitation not found.", 404);
  if (invite.status !== "PENDING") return err(`This invitation has already been ${invite.status.toLowerCase()}.`, 409);
  if (invite.expiresAt < new Date()) return err("This invitation has expired.", 410);

  const existingUser = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });

  return ok({
    invite: { email: invite.email, orgName: invite.org.name, expiresAt: invite.expiresAt },
    accountExists: !!existingUser,
  });
}
