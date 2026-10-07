/**
 * POST /api/admin/invitations/[id]?action=resend|expire|suppress
 *
 * Fix: resend creates a delivery job instead of sending inline.
 * All actions write platformAuditLog.
 */
import { prisma }      from "@/lib/db.js";
import { ok, err }     from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { isSuppressed, suppress } from "@/lib/suppression.js";

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const body   = await request.json().catch(() => ({}));
  const type   = body.type || "installer";

  let invite;
  if (type === "installer") {
    invite = await prisma.installerCustomerInvite.findUnique({ where: { id: params.id } });
  } else {
    invite = await prisma.enterpriseHomeownerInvite.findUnique({ where: { id: params.id } });
  }
  if (!invite) return err("Invitation not found", 404);

  let updated;

  if (action === "resend") {
    // P1-5: use isSuppressed (read-only lookup) not suppress() (writes to list)
    const suppression = await isSuppressed(invite.email);
    if (suppression) return err(`${invite.email} is suppressed (${suppression.reason}). Remove from suppression list before resending.`, 409);

    // P1-6: campaignId is nullable — standalone invites can still be resent
    const campaignId = invite.campaignId ?? null;
    const invType    = type === "installer" ? "INSTALLER" : "ENTERPRISE_HOMEOWNER";

    // Upsert: create job or re-queue existing one — idempotent
    if (campaignId) {
      await prisma.invitationDeliveryJob.upsert({
        where:  { invitationType_invitationId_campaignId: { invitationType: invType, invitationId: invite.id, campaignId } },
        create: { invitationType: invType, invitationId: invite.id, campaignId, recipientEmail: invite.email, status: "PENDING", availableAt: new Date() },
        update: { status: "PENDING", availableAt: new Date(), lastError: null },
      });
    } else {
      // Standalone invite — create a fresh job (no unique constraint without campaignId)
      await prisma.invitationDeliveryJob.create({
        data: { invitationType: invType, invitationId: invite.id, campaignId: null,
                recipientEmail: invite.email, status: "PENDING", availableAt: new Date() },
      }).catch(() => {
        // If duplicate exists, update it
        return prisma.invitationDeliveryJob.updateMany({
          where: { invitationType: invType, invitationId: invite.id, campaignId: null },
          data:  { status: "PENDING", availableAt: new Date(), lastError: null },
        });
      });
    }

    updated = invite;

  } else if (action === "expire") {
    if (type === "installer") {
      updated = await prisma.installerCustomerInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    } else {
      updated = await prisma.enterpriseHomeownerInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    }

  } else if (action === "suppress") {
    await suppress(invite.email, "ADMIN", "admin-panel", { inviteId: invite.id, reason: body.reason });
    if (type === "installer") {
      updated = await prisma.installerCustomerInvite.update({ where: { id: invite.id }, data: { status: "SUPPRESSED" } });
    } else {
      updated = await prisma.enterpriseHomeownerInvite.update({ where: { id: invite.id }, data: { status: "SUPPRESSED" } });
    }

  } else {
    return err("Invalid action. Use: resend | expire | suppress", 400);
  }

  // Audit log
  await prisma.platformAuditLog.create({
    data: {
      actorUserId: auth.user.id,
      actorRole:   "ADMIN",
      action:      `INVITATION_${action.toUpperCase()}`,
      targetType:  type === "installer" ? "InstallerCustomerInvite" : "EnterpriseHomeownerInvite",
      targetId:    invite.id,
      category:    "REFERRAL",
      metadata:    { email: invite.email, action, reason: body.reason, type },
    },
  }).catch(() => {});

  return ok({ message: `Invitation ${action}d`, queued: action === "resend", invite: updated });
}
