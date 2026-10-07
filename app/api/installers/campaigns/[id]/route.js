/**
 * GET  /api/installers/campaigns/[id] — funnel analytics
 * POST /api/installers/campaigns/[id] — queue campaign for delivery (no inline send)
 *
 * Fix 2: All sends go through InvitationDeliveryJob — no inline email loop.
 * Fix 4: Enterprise handled in /api/enterprise/campaigns/[id] — installer click
 *        URLs go through /api/invites/installer/[token]/click for tracking.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z }                   from "zod";

const sendSchema = z.object({
  inviteIds:          z.array(z.string()).optional(),
  resendUnopenedOnly: z.boolean().optional(),
}).optional();

export async function GET(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer not found", 404);

  const campaign = await prisma.installerCampaign.findFirst({
    where: { id: params.id, installerId: installer.id },
    include: {
      invites: {
        select: { status:true, sentAt:true, openedAt:true, clickedAt:true,
                  signedUpAt:true, subscribedAt:true, lastSendError:true },
      },
    },
  });
  if (!campaign) return err("Campaign not found", 404);

  const inv = campaign.invites;
  const funnel = {
    total:      inv.length,
    sent:       inv.filter(i => i.sentAt).length,
    opened:     inv.filter(i => i.openedAt).length,
    clicked:    inv.filter(i => i.clickedAt).length,
    signedUp:   inv.filter(i => i.signedUpAt).length,
    subscribed: inv.filter(i => i.subscribedAt).length,
    failed:     inv.filter(i => i.lastSendError).length,
  };
  const rates = {
    openRate:    funnel.sent    ? `${(funnel.opened   / funnel.sent     * 100).toFixed(1)}%` : "—",
    clickRate:   funnel.opened  ? `${(funnel.clicked  / funnel.opened   * 100).toFixed(1)}%` : "—",
    signupRate:  funnel.clicked ? `${(funnel.signedUp / funnel.clicked  * 100).toFixed(1)}%` : "—",
    convertRate: funnel.signedUp? `${(funnel.subscribed/funnel.signedUp * 100).toFixed(1)}%` : "—",
  };

  return ok({ campaign, funnel, rates });
}

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
    select: { id:true, companyName:true, referralCode:true },
  });
  if (!installer) return err("Installer not found", 404);

  const campaign = await prisma.installerCampaign.findFirst({
    where: { id: params.id, installerId: installer.id },
  });
  if (!campaign) return err("Campaign not found", 404);
  if (["QUEUED","SENDING","SENT"].includes(campaign.status)) {
    return err("Campaign is already queued or sent. Create a new campaign to send again.", 400);
  }

  const body = await request.json().catch(() => ({}));

  // Determine recipients
  let inviteWhere = {
    installerId: installer.id,
    campaignId: campaign.id,
    sentAt: null,
    status: { notIn: ["SIGNED_UP","SUBSCRIBED","DECLINED","SUPPRESSED","EXPIRED"] },
  };
  if (body.inviteIds?.length) {
    inviteWhere = {
      id: { in: body.inviteIds },
      installerId: installer.id,
      status: { notIn: ["SIGNED_UP","SUBSCRIBED","DECLINED","SUPPRESSED","EXPIRED"] },
    };
  } else if (body.resendUnopenedOnly) {
    inviteWhere = {
      campaignId: campaign.id,
      installerId: installer.id,
      sentAt: { not: null },
      openedAt: null,
      status: { notIn: ["SIGNED_UP","SUBSCRIBED","DECLINED","SUPPRESSED","EXPIRED"] },
    };
  }

  const recipients = await prisma.installerCustomerInvite.findMany({
    where: inviteWhere,
    select: { id: true, email: true },
  });

  if (recipients.length === 0) {
    return err("No eligible recipients found. Import customers or adjust filters.", 400);
  }

  // Fix 2: Create delivery jobs — no inline send loop
  await prisma.$transaction(async tx => {
    await tx.invitationDeliveryJob.createMany({
      data: recipients.map(inv => ({
        invitationType: "INSTALLER",
        invitationId:   inv.id,
        campaignId:     campaign.id,
        recipientEmail: inv.email,
        availableAt:    new Date(),
      })),
      skipDuplicates: true,
    });
    await tx.installerCampaign.update({
      where: { id: campaign.id },
      data:  { status: "QUEUED", queuedAt: new Date() },
    });
  });

  return ok({
    queued:   recipients.length,
    message:  `${recipients.length} delivery job${recipients.length !== 1 ? "s" : ""} queued. Emails will be sent within minutes.`,
    status:   "QUEUED",
  });
}
