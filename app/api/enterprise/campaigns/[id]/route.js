/**
 * GET  /api/enterprise/campaigns/[id] — funnel analytics
 * POST /api/enterprise/campaigns/[id] — queue campaign for delivery (no inline send)
 *
 * Fix 2: Queue-based. Fix 4: Click-tracker URL used in delivery worker.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err }             from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";

export async function GET(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);

  const campaign = await prisma.enterpriseCampaign.findFirst({
    where: { id: params.id, orgId: access.org.id },
    include: {
      invites: {
        select: { status:true, sentAt:true, openedAt:true, clickedAt:true,
                  signedUpAt:true, subscribedAt:true },
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

  return ok({ campaign, funnel });
}

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);

  const campaign = await prisma.enterpriseCampaign.findFirst({
    where: { id: params.id, orgId: access.org.id },
  });
  if (!campaign) return err("Campaign not found", 404);
  if (["QUEUED","SENDING","SENT"].includes(campaign.status)) {
    return err("Campaign already queued or sent.", 400);
  }

  const body = await request.json().catch(() => ({}));
  let inviteWhere = {
    orgId:   access.org.id,
    campaignId: campaign.id,
    sentAt:  null,
    status:  { notIn: ["SIGNED_UP","SUBSCRIBED","DECLINED","SUPPRESSED","EXPIRED"] },
  };
  if (body.inviteIds?.length) {
    inviteWhere = {
      id: { in: body.inviteIds },
      orgId: access.org.id,
      status: { notIn: ["SIGNED_UP","SUBSCRIBED","DECLINED","SUPPRESSED","EXPIRED"] },
    };
  }

  const recipients = await prisma.enterpriseHomeownerInvite.findMany({
    where: inviteWhere, select: { id:true, email:true },
  });

  if (recipients.length === 0) return err("No eligible recipients.", 400);

  // Fix 2: queue — no inline send
  await prisma.$transaction(async tx => {
    await tx.invitationDeliveryJob.createMany({
      data: recipients.map(inv => ({
        invitationType: "ENTERPRISE_HOMEOWNER",
        invitationId:   inv.id,
        campaignId:     campaign.id,
        recipientEmail: inv.email,
        availableAt:    new Date(),
      })),
      skipDuplicates: true,
    });
    await tx.enterpriseCampaign.update({
      where: { id: campaign.id },
      data:  { status: "QUEUED", queuedAt: new Date() },
    });
  });

  return ok({ queued: recipients.length, status: "QUEUED" });
}
