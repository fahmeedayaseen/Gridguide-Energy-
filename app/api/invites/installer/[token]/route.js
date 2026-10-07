/**
 * GET /api/invites/installer/[token]
 * Public, unauthenticated — resolve an installer invite token so the
 * landing page can render the installer's name and system details
 * before the visitor creates an account or logs in.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

export async function GET(request, { params }) {
  const invite = await prisma.installerCustomerInvite.findUnique({
    where: { inviteToken: params.token },
    include: {
      installer: { select: { companyName: true, rating: true, jobsCompleted: true, referralCode: true } },
    },
  });

  if (!invite) return err("Invitation not found.", 404);
  if (["SIGNED_UP","SUBSCRIBED","DECLINED"].includes(invite.status)) {
    return err(`This invitation has already been ${invite.status.toLowerCase().replace("_"," ")}.`, 409);
  }

  // Mark opened — idempotent (only update if not already opened)
  if (!invite.openedAt) {
    await prisma.installerCustomerInvite.update({
      where: { id: invite.id },
      data: { openedAt: new Date(), status: "OPENED" },
    }).catch(() => {});

    // Increment campaign openCount if attached
    if (invite.campaignId) {
      await prisma.installerCampaign.update({
        where: { id: invite.campaignId },
        data: { openCount: { increment: 1 } },
      }).catch(() => {});
    }
  }

  const existingUser = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });

  return ok({
    invite: {
      email:          invite.email,
      firstName:      invite.firstName,
      lastName:       invite.lastName,
      systemType:     invite.systemType,
      batterySystem:  invite.batterySystem,
      utility:        invite.utility,
      installerName:  invite.installer.companyName,
      installerRating:invite.installer.rating,
      installerJobs:  invite.installer.jobsCompleted,
      referralCode:   invite.installer.referralCode,
    },
    accountExists: !!existingUser,
  });
}
