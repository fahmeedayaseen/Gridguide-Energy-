/**
 * POST /api/invites/homeowner/[token]/decline — no account creation or
 * authentication required, so declining is never gated behind having to
 * create an account just to say no.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { logAudit } from "@/lib/audit.js";

export async function POST(request, { params }) {
  const invite = await prisma.enterpriseHomeownerInvite.findUnique({
    where: { token: params.token },
    include: { org: { select: { id: true } } },
  });
  if (!invite) return err("Invitation not found.", 404);
  if (invite.status !== "PENDING") return err(`This invitation has already been ${invite.status.toLowerCase()}.`, 409);

  await prisma.enterpriseHomeownerInvite.update({
    where: { id: invite.id },
    data: { status: "DECLINED", respondedAt: new Date() },
  });

  await logAudit({
    action: "HOMEOWNER_INVITE_DECLINED", targetType: "EnterpriseHomeownerInvite",
    targetId: invite.id, orgId: invite.org.id, category: "ASSIGNMENT",
    metadata: { email: invite.email },
  });

  return ok({ message: "Invitation declined." });
}
