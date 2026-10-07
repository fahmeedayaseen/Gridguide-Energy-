/**
 * GET /api/sellers/team/invites/[token]/info
 * Public endpoint — no auth required.
 * Returns invite details so the landing page can render seller name, role, expiry.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

export async function GET(request, { params }) {
  const invite = await prisma.sellerTeamInvite.findUnique({
    where: { token: params.token },
    include: { },
  });
  if (!invite) return err("Invitation not found", 404);

  const expired  = invite.expiresAt < new Date();
  const terminal = ["ACCEPTED","DECLINED","EXPIRED"].includes(invite.status);
  if (expired || terminal) {
    const msg = expired                           ? "This invitation has expired."
              : invite.status === "ACCEPTED"      ? "This invitation has already been accepted."
              : invite.status === "DECLINED"      ? "This invitation was declined."
              :                                     "This invitation is no longer valid.";
    return err(msg, 410);
  }

  const seller = await prisma.seller.findUnique({
    where:  { id: invite.sellerId },
    select: { companyName: true },
  });

  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
    select: { id: true },
  });

  return ok({
    invite: {
      email:        invite.email,
      role:         invite.role,
      sellerName:   seller?.companyName || "A GridGuide seller",
      expiresAt:    invite.expiresAt,
      accountExists:!!existingUser,
    },
  });
}
