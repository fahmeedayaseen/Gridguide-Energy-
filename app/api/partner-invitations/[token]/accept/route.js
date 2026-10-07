import { prisma }      from "@/lib/db.js";
import { ok, err }      from "@/lib/auth.js";
import { requireAuth }  from "@/lib/jwt.js";

// Authenticated: accept an invitation.
// Only the user whose email matches can accept.
// Acceptance ≠ approval — the admin reviews + activates the account separately.
export async function POST(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return err(auth.error, auth.status);

  const invitation = await prisma.partnerInvitation.findUnique({
    where: { token: params.token },
  });
  if (!invitation)                           return err("Invitation not found", 404);
  if (invitation.expiresAt < new Date())     return err("Invitation has expired", 410);
  if (!["SENT","OPENED"].includes(invitation.status)) {
    return err("Invitation is no longer available", 409);
  }
  if (auth.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return err("This invitation was sent to a different email address", 403);
  }

  // Atomically reserve acceptance: only succeeds if status is still SENT/OPENED,
  // so two concurrent accept requests can't both go through.
  const claimed = await prisma.partnerInvitation.updateMany({
    where: { id: invitation.id, status: { in: ["SENT", "OPENED"] } },
    data: {
      status:           "ACCEPTED",
      acceptedAt:       new Date(),
      acceptedByUserId: auth.user.id,
    },
  });
  if (claimed.count !== 1) {
    return err("Invitation was already processed", 409);
  }

  const updated = await prisma.partnerInvitation.findUnique({
    where: { id: invitation.id },
  });

  await prisma.platformAuditLog.create({
    data: {
      actorUserId: auth.user.id,
      actorRole:   "CONSUMER",
      action:      "PARTNER_INVITATION_ACCEPTED",
      targetType:  "PartnerInvitation",
      targetId:    invitation.id,
      category:    "TEAM",
      metadata:    { type: invitation.type, companyName: invitation.companyName },
    },
  }).catch(() => {});

  // nextStep routes the partner into the correct onboarding flow
  return ok({
    invitation: updated,
    message:    "Invitation accepted. GridGuide will review and activate your account.",
    nextStep:   `/onboarding/${invitation.type.toLowerCase()}`,
  });
}
