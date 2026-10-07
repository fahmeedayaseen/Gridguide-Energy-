/**
 * POST /api/invites/installer/[token]/decline
 * Marks the invite DECLINED — no account created, no referral created.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

export async function POST(request, { params }) {
  const invite = await prisma.installerCustomerInvite.findUnique({
    where: { inviteToken: params.token },
  });
  if (!invite) return err("Invitation not found.", 404);
  if (["SIGNED_UP","SUBSCRIBED","DECLINED"].includes(invite.status)) {
    return err("This invitation has already been processed.", 409);
  }

  await prisma.installerCustomerInvite.update({
    where: { id: invite.id },
    data:  { status: "DECLINED" },
  });

  return ok({ message: "Invitation declined." });
}
