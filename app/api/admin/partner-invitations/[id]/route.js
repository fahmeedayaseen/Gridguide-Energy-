import { z }      from "zod";
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody }          from "@/lib/auth.js";
import { requireRole }                 from "@/lib/jwt.js";
import { sendPartnerInvitationEmail }  from "@/lib/email.js";
import { approveAcceptedPartnerInvitation } from "@/lib/partner-invitations.js";

const actionSchema = z.object({
  action: z.enum(["SEND","RESEND","CANCEL","APPROVE","REJECT"]),
  note:   z.string().max(2000).optional(),
}).strict();

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const invitation = await prisma.partnerInvitation.findUnique({ where: { id: params.id } });
  if (!invitation) return err("Partner invitation not found", 404);
  return ok({ invitation });
}

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, actionSchema);
  if (error) return err("Validation failed", 400, error);

  const invitation = await prisma.partnerInvitation.findUnique({ where: { id: params.id } });
  if (!invitation) return err("Partner invitation not found", 404);

  // ── SEND / RESEND ──────────────────────────────────────────────────────────
  if (["SEND","RESEND"].includes(data.action)) {
    if (["CANCELLED","APPROVED","REJECTED"].includes(invitation.status)) {
      return err("This invitation can no longer be sent", 409);
    }

    // Prefer delivery queue; fall back to inline send
    const job = await prisma.invitationDeliveryJob.create({
      data: {
        invitationType: "PARTNER_INVITATION",
        invitationId:   invitation.id,
        campaignId:     null,
        recipientEmail: invitation.email,
        status:         "PENDING",
        availableAt:    new Date(),
      },
    });

    const updated = await prisma.partnerInvitation.update({
      where: { id: invitation.id },
      data: {
        status:      "SENT",
        sentAt:      invitation.sentAt || new Date(),
        lastSentAt:  new Date(),
        resendCount: { increment: data.action === "RESEND" ? 1 : 0 },
        lastSendError: null,
      },
    });

    await prisma.platformAuditLog.create({
      data: {
        actorUserId: auth.user.id, actorRole: "ADMIN",
        action: data.action === "RESEND" ? "PARTNER_INVITATION_RESENT" : "PARTNER_INVITATION_SENT",
        targetType: "PartnerInvitation", targetId: invitation.id, category: "TEAM",
        metadata: { email: invitation.email, companyName: invitation.companyName, deliveryJobId: job.id },
      },
    }).catch(() => {});

    return ok({ invitation: updated, deliveryJobId: job.id });
  }

  // ── CANCEL ─────────────────────────────────────────────────────────────────
  if (data.action === "CANCEL") {
    if (["CANCELLED","APPROVED","REJECTED"].includes(invitation.status)) {
      return err("Invitation is already in a terminal state", 409);
    }
    const updated = await prisma.partnerInvitation.update({
      where: { id: invitation.id },
      data: { status: "CANCELLED", cancelledAt: new Date(),
              ...(data.note && { internalNote: data.note }) },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorUserId: auth.user.id, actorRole: "ADMIN",
        action: "PARTNER_INVITATION_CANCELLED",
        targetType: "PartnerInvitation", targetId: invitation.id, category: "TEAM",
        metadata: { reason: data.note },
      },
    }).catch(() => {});
    return ok({ invitation: updated });
  }

  // ── REJECT ─────────────────────────────────────────────────────────────────
  if (data.action === "REJECT") {
    const updated = await prisma.partnerInvitation.update({
      where: { id: invitation.id },
      data: { status: "REJECTED", rejectedAt: new Date(),
              approvedByUserId: auth.user.id,
              ...(data.note && { internalNote: data.note }) },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorUserId: auth.user.id, actorRole: "ADMIN",
        action: "PARTNER_INVITATION_REJECTED",
        targetType: "PartnerInvitation", targetId: invitation.id, category: "TEAM",
        metadata: { reason: data.note, companyName: invitation.companyName },
      },
    }).catch(() => {});
    return ok({ invitation: updated });
  }

  // ── APPROVE ────────────────────────────────────────────────────────────────
  if (invitation.status !== "ACCEPTED") {
    return err("Invitation must be accepted by the partner before admin approval", 409);
  }
  if (!invitation.acceptedByUserId) {
    return err("No accepted user linked to this invitation", 409);
  }

  const result = await approveAcceptedPartnerInvitation(invitation, auth.user.id);
  return ok(result);
}
