import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

// Public: returns safe invite info + marks OPENED
export async function GET(_request, { params }) {
  const invitation = await prisma.partnerInvitation.findUnique({
    where: { token: params.token },
  });
  if (!invitation) return err("Invitation not found", 404);

  // Auto-expire
  if (invitation.expiresAt < new Date() &&
      !["APPROVED","REJECTED","CANCELLED","EXPIRED"].includes(invitation.status)) {
    await prisma.partnerInvitation.update({
      where: { id: invitation.id },
      data:  { status: "EXPIRED" },
    });
    return err("Invitation has expired", 410);
  }

  if (["CANCELLED","REJECTED"].includes(invitation.status)) {
    return err("Invitation is no longer available", 410);
  }

  // Mark OPENED once (idempotent on subsequent loads)
  if (invitation.status === "SENT") {
    await prisma.partnerInvitation.update({
      where: { id: invitation.id },
      data:  { status: "OPENED", openedAt: new Date() },
    });
  }

  // Return only fields safe to expose publicly — no commission details
  return ok({
    invitation: {
      type:         invitation.type,
      companyName:  invitation.companyName,
      contactName:  invitation.contactName,
      email:        invitation.email,
      assignedPlan: invitation.assignedPlan,
      expiresAt:    invitation.expiresAt,
      status:       invitation.status === "SENT" ? "OPENED" : invitation.status,
    },
  });
}
