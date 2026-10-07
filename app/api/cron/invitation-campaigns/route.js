/**
 * POST /api/cron/invitation-campaigns
 * Finds due SCHEDULED campaigns, marks them QUEUED, and creates
 * InvitationDeliveryJob rows for each recipient.
 * Protected by CRON_SECRET — call from Vercel Cron / external scheduler.
 *
 * Idempotent: uses skipDuplicates on createMany so double-runs are safe.
 * Atomically transitions campaign status to prevent parallel workers queuing twice.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

export async function POST(request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  let installerQueued = 0, enterpriseQueued = 0, errors = [];

  // ── Installer campaigns ─────────────────────────────────────────────────────
  const installerCampaigns = await prisma.installerCampaign.findMany({
    where:   { status: "SCHEDULED", scheduledAt: { lte: now } },
    include: { invites: { where: { sentAt: null, status: { notIn: ["SIGNED_UP","SUBSCRIBED","DECLINED"] } }, select: { id:true, email:true } } },
  });

  for (const camp of installerCampaigns) {
    try {
      await prisma.$transaction(async tx => {
        // Atomic status check-and-set prevents parallel workers double-queuing
        const locked = await tx.installerCampaign.updateMany({
          where: { id: camp.id, status: "SCHEDULED" },
          data:  { status: "QUEUED", queuedAt: now },
        });
        if (locked.count === 0) return; // already grabbed by another worker

        await tx.invitationDeliveryJob.createMany({
          data: camp.invites.map(inv => ({
            invitationType: "INSTALLER",
            invitationId:   inv.id,
            campaignId:     camp.id,
            recipientEmail: inv.email,
            availableAt:    now,
          })),
          skipDuplicates: true,
        });
      });
      installerQueued++;
    } catch (e) {
      errors.push({ campaignId: camp.id, error: e.message });
    }
  }

  // ── Enterprise campaigns ────────────────────────────────────────────────────
  const enterpriseCampaigns = await prisma.enterpriseCampaign.findMany({
    where:   { status: "SCHEDULED", scheduledAt: { lte: now } },
    include: { invites: { where: { sentAt: null, status: { notIn: ["SIGNED_UP","SUBSCRIBED","DECLINED"] } }, select: { id:true, email:true } } },
  });

  for (const camp of enterpriseCampaigns) {
    try {
      await prisma.$transaction(async tx => {
        const locked = await tx.enterpriseCampaign.updateMany({
          where: { id: camp.id, status: "SCHEDULED" },
          data:  { status: "QUEUED", queuedAt: now },
        });
        if (locked.count === 0) return;

        await tx.invitationDeliveryJob.createMany({
          data: camp.invites.map(inv => ({
            invitationType: "ENTERPRISE_HOMEOWNER",
            invitationId:   inv.id,
            campaignId:     camp.id,
            recipientEmail: inv.email,
            availableAt:    now,
          })),
          skipDuplicates: true,
        });
      });
      enterpriseQueued++;
    } catch (e) {
      errors.push({ campaignId: camp.id, error: e.message });
    }
  }


  // P0-3: Process due Seller campaigns
  let sellerQueued = 0;
  const sellerCampaigns = await prisma.sellerCampaign.findMany({
    where:   { status: "SCHEDULED", scheduledAt: { lte: now } },
    include: { recipients: { where: { status: "PENDING" }, select: { id:true, email:true } } },
  });
  for (const camp of sellerCampaigns) {
    try {
      // Fix: return the count from the transaction so the closure mutation works
      const jobsQueued = await prisma.$transaction(async tx => {
        const locked = await tx.sellerCampaign.updateMany({
          where: { id: camp.id, status: "SCHEDULED" },
          data:  { status: "QUEUED", queuedAt: now },
        });
        if (locked.count === 0) return 0; // another worker grabbed it

        const queuedCount = camp.recipients.length;
        if (queuedCount === 0) {
          // No pending recipients — mark FAILED rather than leaving stuck in QUEUED
          await tx.sellerCampaign.update({
            where: { id: camp.id },
            data:  { status: "FAILED", failedAt: now },
          });
          return 0;
        }

        await tx.invitationDeliveryJob.createMany({
          data: camp.recipients.map(r => ({
            invitationType: "SELLER_MESSAGE",
            invitationId:   r.id,
            campaignId:     camp.id,
            recipientEmail: r.email,
            status:         "PENDING",
            availableAt:    now,
          })),
          skipDuplicates: true,
        });
        return queuedCount; // propagate count out of the transaction closure
      });
      sellerQueued += (jobsQueued ?? 0);
    } catch (e) {
      errors.push({ campaignId: camp.id, type: "seller", error: e.message });
    }
  }

  return Response.json({
    installerCampaigns:  installerQueued,
    enterpriseCampaigns: enterpriseQueued,
    sellerCampaigns:     sellerQueued,     // total jobs queued (not campaign count)
    errors,
    processedAt: now.toISOString(),
  });
}
