/**
 * POST /api/sellers/team/invites/[token]/accept
 * P0: Creates SellerTeamMember in one $transaction with invite update.
 */
import { prisma }             from "@/lib/db.js";
import { ok, err }            from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err("Authentication required", 401);

  const invite = await prisma.sellerTeamInvite.findUnique({ where: { token: params.token } });
  if (!invite)                                        return err("Invitation not found", 404);
  if (invite.expiresAt < new Date())                  return err("Invitation has expired", 410);
  if (invite.status === "ACCEPTED")                   return err("This invitation has already been accepted", 409);
  if (invite.status !== "PENDING")                    return err("Invitation is no longer valid", 410);
  if (invite.email.toLowerCase() !== auth.user.email.toLowerCase()) {
    return err("This invitation was sent to a different email address", 403);
  }

  // Validate role value against SellerTeamRole enum before upsert
  const VALID_ROLES = ["OWNER","MANAGER","SUPPORT","VIEWER"];
  const role = VALID_ROLES.includes(invite.role?.toUpperCase())
    ? invite.role.toUpperCase()
    : "VIEWER"; // safe default if stored role is invalid

  // P0: create membership and mark invite in one transaction — no orphan invites
  await prisma.$transaction(async tx => {
    await tx.sellerTeamMember.upsert({
      where:  { sellerId_userId: { sellerId: invite.sellerId, userId: auth.user.id } },
      create: { sellerId: invite.sellerId, userId: auth.user.id, role, status: "ACTIVE" },
      update: { role, status: "ACTIVE" },
    });
    await tx.sellerTeamInvite.update({
      where: { id: invite.id },
      data:  { status: "ACCEPTED", acceptedAt: new Date() },
    });
  });

  const seller = await prisma.seller.findUnique({
    where:  { id: invite.sellerId },
    select: { companyName: true },
  });

  return ok({
    message:    `You've joined ${seller?.companyName || "the seller team"} as ${role}.`,
    role,
    sellerId:   invite.sellerId,
    sellerName: seller?.companyName,
  });
}
