/**
 * POST /api/cron/process-delivery-jobs
 * Background worker — processes up to 100 InvitationDeliveryJob rows per run.
 * Checks suppression, sends email, persists result.
 * Retries up to 3 times with exponential backoff (availableAt pushed forward).
 *
 * Call this endpoint every minute from Vercel Cron / external scheduler.
 */
import { prisma }                                   from "@/lib/db.js";
import { isSuppressed }                             from "@/lib/suppression.js";
import { verifyCronRequest } from "@/lib/secrets.js";
import { sendInstallerInvite, sendHomeownerInvite,
         sendEmail }                                from "@/lib/email.js";

const MAX_ATTEMPTS = 3;
const BATCH_SIZE   = 100;

export async function POST(request) {
  // Rejects when CRON_SECRET is unset. The old check compared against
  // `Bearer ${undefined}`, so an unset secret accepted "Bearer undefined".
  if (!verifyCronRequest(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const jobs = await prisma.invitationDeliveryJob.findMany({
    where: { status: { in: ["PENDING","QUEUED"] }, availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0, failed = 0, skipped = 0;

  for (const job of jobs) {
    // Check suppression first
    const suppressed = await isSuppressed(job.recipientEmail);
    if (suppressed) {
      // P1: sync suppression to both job and invitation record in one transaction
      await prisma.$transaction(async tx => {
        await tx.invitationDeliveryJob.update({
          where: { id: job.id },
          data:  { status: "SUPPRESSED", processedAt: new Date(),
                   lastError: `Suppressed: ${suppressed.reason}` },
        });
        const suppressData = { status: "SUPPRESSED",
                               lastSendError: "Recipient is on the suppression list.",
                               lastAttemptAt: new Date() };
        if (job.invitationType === "INSTALLER") {
          await tx.installerCustomerInvite.updateMany({
            where: { id: job.invitationId }, data: suppressData,
          });
        } else if (job.invitationType === "ENTERPRISE_HOMEOWNER") {
          await tx.enterpriseHomeownerInvite.updateMany({
            where: { id: job.invitationId }, data: suppressData,
          });
        } else if (job.invitationType === "SELLER_MESSAGE") {
          // Sync suppression to SellerCampaignRecipient
          await tx.sellerCampaignRecipient.updateMany({
            where: { id: job.invitationId },
            data:  { status: "SUPPRESSED", failedAt: new Date(), lastAttemptAt: new Date(),
                     lastSendError: suppressData.lastSendError },
          });
        } else if (job.invitationType === "SELLER_TEAM_INVITE") {
          await tx.sellerTeamInvite.updateMany({
            where: { id: job.invitationId },
            data:  { lastAttemptAt: new Date(), lastSendError: suppressData.lastSendError },
          });
        }
      });
      skipped++;
      continue;
    }

    // Mark SENDING (prevents parallel workers from double-sending)
    const claim = await prisma.invitationDeliveryJob.updateMany({
      where: { id: job.id, status: { in: ["PENDING","QUEUED"] } },
      data:  { status: "SENDING" },
    });
    if (claim.count === 0) continue; // grabbed by another worker

    let providerId = null;
    try {
      // ── Dispatch by invitationType ──────────────────────────────────────────
      if (job.invitationType === "INSTALLER") {
        const invite = await prisma.installerCustomerInvite.findUnique({
          where:   { id: job.invitationId },
          include: { installer: { select: { companyName:true, referralCode:true } },
                     campaign:  { select: { subject:true, body:true } } },
        });
        if (!invite) throw new Error("Installer invite not found");
        const baseUrl    = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
        const code       = invite.installer?.referralCode || invite.installerId;
        const inviteUrl  = `${baseUrl}/api/invites/installer/${invite.inviteToken}/click`;
        const landingUrl = `${baseUrl}/join/${code}/${invite.inviteToken}`;
        const sendResult = await sendInstallerInvite(invite.email, {
          installerName: invite.installer?.companyName || "Your installer",
          inviteUrl, landingUrl, firstName: invite.firstName,
          subject: invite.campaign?.subject, body: invite.campaign?.body,
        });
        providerId = sendResult?.providerId ?? null;
        await prisma.installerCustomerInvite.update({
          where: { id: invite.id },
          data:  { sentAt: new Date(), status: "SENT", sendAttempts: { increment: 1 }, lastSendError: null },
        });

      } else if (job.invitationType === "ENTERPRISE_HOMEOWNER") {
        const invite = await prisma.enterpriseHomeownerInvite.findUnique({
          where:   { id: job.invitationId },
          include: { org: { select: { name:true } } },
        });
        if (!invite) throw new Error("Enterprise invite not found");
        const baseUrl  = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
        const clickUrl = `${baseUrl}/api/invites/homeowner/${invite.token}/click`;
        const entResult = await sendHomeownerInvite(invite.email, invite.org, invite.token, { clickUrl });
        providerId = entResult?.providerId ?? null;
        await prisma.enterpriseHomeownerInvite.update({
          where: { id: invite.id },
          data:  { sentAt: new Date(), status: "SENT", sendAttempts: { increment: 1 }, lastSendError: null },
        });

      } else if (job.invitationType === "SELLER_MESSAGE") {
        const recipient = await prisma.sellerCampaignRecipient.findUnique({
          where:   { id: job.invitationId },
          include: { campaign: { include: { seller: { select: { companyName:true, id:true } } } } },
        });
        if (!recipient) throw new Error(`Seller campaign recipient not found: ${job.invitationId}`);

        // Inline suppression check — catch suppression that slipped past queue-time check
        const recipientSupp = await isSuppressed(recipient.email);
        if (recipientSupp) {
          await prisma.$transaction([
            prisma.invitationDeliveryJob.update({
              where: { id: job.id },
              data:  { status: "SUPPRESSED", processedAt: new Date(), lastError: `Suppressed: ${recipientSupp.reason}` },
            }),
            prisma.sellerCampaignRecipient.update({
              where: { id: recipient.id },
              data:  { status: "SUPPRESSED", failedAt: new Date(), lastSendError: `Suppressed: ${recipientSupp.reason}` },
            }),
          ]);
          skipped++; continue;
        }

        const baseUrl    = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
        const sellerName = recipient.campaign?.seller?.companyName || "GridGuide Seller";
        const unsubUrl   = `${baseUrl}/unsubscribe/${recipient.unsubscribeKey}`;
        const footer     = `<p style="font-size:11px;color:#aaa;text-align:center;margin-top:20px">Sent by ${sellerName} via GridGuide. <a href="${unsubUrl}">Unsubscribe</a></p>`;
        const result = await sendEmail({
          to:      recipient.email,
          subject: recipient.campaign?.subject || `Message from ${sellerName}`,
          html:    (recipient.campaign?.bodyHtml || "") + footer,
          text:    recipient.campaign?.bodyText || undefined,
        });
        if (!result?.success) throw new Error(result?.error || "Seller email send failed.");
        providerId = result?.providerId ?? null;
        await prisma.sellerCampaignRecipient.update({
          where: { id: recipient.id },
          data:  { status: "SENT", sentAt: new Date(), sendAttempts: { increment: 1 },
                   lastSendError: null, providerId },
        });
        if (recipient.campaign?.seller?.id) {
          try {
            await prisma.sellerMessageLog.create({
              data: {
                sellerId:   recipient.campaign.seller.id,
                customerId: recipient.customerId ?? null,
                campaignId: recipient.campaignId,
                type:       "PROMOTIONAL_CAMPAIGN",
                toEmail:    recipient.email,
                subject:    recipient.campaign?.subject || "",
                providerId, status: "SENT", sentAt: new Date(),
              },
            });
          } catch (logError) {
            console.error("Seller message log creation failed", {
              jobId: job.id,
              invitationId: job.invitationId,
              campaignId: job.campaignId,
              error: logError instanceof Error ? logError.message : String(logError),
            });
          }
        }

      } else if (job.invitationType === "SELLER_TEAM_INVITE") {
        const invite = await prisma.sellerTeamInvite.findUnique({
          where: { id: job.invitationId },
        });
        if (!invite) throw new Error(`Seller team invite not found: ${job.invitationId}`);

        const teamSupp = await isSuppressed(invite.email);
        if (teamSupp) {
          await prisma.invitationDeliveryJob.update({
            where: { id: job.id },
            data:  { status: "SUPPRESSED", processedAt: new Date(),
                     lastError: `Suppressed: ${teamSupp.reason}` },
          });
          skipped++; continue;
        }

        const seller    = await prisma.seller.findUnique({ where: { id: invite.sellerId }, select: { companyName:true } });
        const baseUrl   = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
        const inviteUrl = `${baseUrl}/seller/join/${invite.token}`;
        const result = await sendEmail({
          to:      invite.email,
          subject: `${seller?.companyName || "A GridGuide seller"} invited you to join their team`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
            <div style="background:#0D1526;border-radius:12px;padding:28px;margin-bottom:20px">
              <h2 style="color:#06B6D4;margin:0 0 8px">${seller?.companyName || "A GridGuide seller"}</h2>
              <p style="color:#8890A8;font-size:13px;margin:0">invited you to join their team on GridGuide</p>
            </div>
            <p style="color:#555;font-size:14px;line-height:1.7;">
              You've been invited as <strong style="color:#E8F0FF">${invite.role}</strong>.
            </p>
            <div style="text-align:center;margin:28px 0">
              <a href="${inviteUrl}" style="background:#06B6D4;color:#0A0F1E;padding:14px 32px;
                border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
                Accept Invitation →
              </a>
            </div>
            <p style="color:#888;font-size:12px;text-align:center">
              Expires in 7 days. Sent to ${invite.email}.
            </p>
          </div>`,
          text: `${seller?.companyName || "A GridGuide seller"} invited you to join as ${invite.role}. Accept: ${inviteUrl}`,
        });
        if (!result?.success) {
          throw new Error(result?.error || "Seller team invitation email failed.");
        }
        providerId = result.providerId ?? null;
        await prisma.sellerTeamInvite.update({
          where: { id: invite.id },
          data:  { sentAt: new Date(), providerId,
                   sendAttempts: { increment: 1 }, lastAttemptAt: new Date(),
                   lastSendError: null },
        });

      } else if (job.invitationType === "PARTNER_INVITATION") {
        const invite = await prisma.partnerInvitation.findUnique({
          where: { id: job.invitationId },
        });
        if (!invite) throw new Error(`PartnerInvitation not found: ${job.invitationId}`);

        // Refuse to (re)send an invitation that has already reached a terminal state.
        const terminalStatuses = new Set(["ACCEPTED", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"]);
        if (terminalStatuses.has(invite.status)) {
          throw new Error(`Refusing to send terminal partner invitation ${invite.id}`);
        }

        // Import here avoids circular dependency on startup
        const { sendPartnerInvitationEmail } = await import("@/lib/email.js");
        const result = await sendPartnerInvitationEmail(invite);
        if (!result?.success) throw new Error(result?.error || "Partner invitation email send failed");
        providerId = result?.providerId ?? null;

        // Fix: successful delivery must move DRAFT invitations to SENT, or acceptance
        // will always fail with "Invitation is no longer available".
        const nextStatus = invite.status === "DRAFT" ? "SENT" : invite.status;
        await prisma.partnerInvitation.update({
          where: { id: invite.id },
          data:  {
            status:        nextStatus,
            sentAt:        invite.sentAt ?? new Date(),
            lastSentAt:    new Date(),
            lastSendError: null,
          },
        });

      } else {
        throw new Error(`Unsupported invitationType: ${job.invitationType}`);
      }

      // ── Success: update delivery job, increment counter ──────────────────────
      await prisma.invitationDeliveryJob.update({
        where: { id: job.id },
        data:  { status: "SENT", processedAt: new Date(), attempts: { increment: 1 },
                 providerId },
      });
      sent++;

    } catch (e) {
      const attempts = (job.attempts || 0) + 1;
      const permanent = attempts >= MAX_ATTEMPTS;
      const delays = [5, 30, 120]; // backoff: 5min, 30min, 2hr
      const backoffMs = (delays[attempts-1] || 120) * 60 * 1000;
      const errMsg = e.message?.slice(0, 500) || "Unknown error";

      // P1: sync failure to both job and invitation in one transaction
      await prisma.$transaction(async tx => {
        await tx.invitationDeliveryJob.update({
          where: { id: job.id },
          data:  {
            status:      permanent ? "FAILED" : "QUEUED",
            lastError:   errMsg,
            attempts:    { increment: 1 },
            processedAt: permanent ? new Date() : undefined,
            availableAt: permanent ? undefined : new Date(Date.now() + backoffMs),
          },
        });
        const failData = { sendAttempts: { increment: 1 }, lastAttemptAt: new Date(), lastSendError: errMsg };
        if (job.invitationType === "INSTALLER") {
          await tx.installerCustomerInvite.updateMany({ where: { id: job.invitationId }, data: failData });
        } else if (job.invitationType === "ENTERPRISE_HOMEOWNER") {
          await tx.enterpriseHomeownerInvite.updateMany({ where: { id: job.invitationId }, data: failData });
        } else if (job.invitationType === "SELLER_MESSAGE") {
          // P1-4: sync failure to SellerCampaignRecipient
          await tx.sellerCampaignRecipient.updateMany({
            where: { id: job.invitationId },
            data:  { status: permanent ? "FAILED" : "QUEUED",
                     failedAt: permanent ? new Date() : null,
                     sendAttempts: { increment: 1 }, lastAttemptAt: new Date(), lastSendError: errMsg },
          });
        } else if (job.invitationType === "SELLER_TEAM_INVITE") {
          await tx.sellerTeamInvite.updateMany({
            where: { id: job.invitationId },
            data:  { sendAttempts: { increment: 1 }, lastAttemptAt: new Date(), lastSendError: errMsg },
          });
        }
      });
      failed++;
    }
  }

  // Fix 10: Reconcile campaign status after batch — mark COMPLETE if all jobs done
  const campaignIds = [...new Set(jobs.map(j => j.campaignId).filter(Boolean))]; // filter null (standalone jobs)
  for (const campaignId of campaignIds) {
    const pending = await prisma.invitationDeliveryJob.count({
      where: { campaignId, status: { in: ["PENDING","QUEUED","SENDING"] } },
    });
    if (pending === 0) {
      // All jobs resolved — determine final status
      const hasFailed = await prisma.invitationDeliveryJob.count({
        where: { campaignId, status: "FAILED" },
      });
      const sentCount = await prisma.invitationDeliveryJob.count({
        where: { campaignId, status: "SENT" },
      });
      const suppressedCount = await prisma.invitationDeliveryJob.count({
        where: { campaignId, status: "SUPPRESSED" },
      });
      // Terminal status includes suppression so campaign totals remain auditable.
      const now = new Date();
      const newStatus = sentCount > 0 && (hasFailed > 0 || suppressedCount > 0)
        ? "PARTIAL"
        : sentCount > 0
          ? "SENT"
          : hasFailed > 0
            ? "FAILED"
            : "CANCELLED";
      // reconcileData: shared fields for InstallerCampaign and EnterpriseCampaign
      // (neither has suppressedCount — that column only exists on SellerCampaign)
      const reconcileData = {
        status:      newStatus,
        completedAt: now,
        sentCount,
        failedCount: hasFailed,
        sentAt:      sentCount > 0 ? now : undefined,
        failedAt:    sentCount === 0 && hasFailed > 0 ? now : undefined,
      };
      // Fix 1: SellerCampaign gets suppressedCount; installer/enterprise do not
      const sellerReconcileData = { ...reconcileData, suppressedCount };

      // Try installer campaign first, then enterprise, then seller
      const updated = await prisma.installerCampaign.updateMany({
        where: { id: campaignId, status: { in: ["QUEUED","SENDING"] } },
        data:  reconcileData,   // no suppressedCount
      });
      if (updated.count === 0) {
        const entUpdated = await prisma.enterpriseCampaign.updateMany({
          where: { id: campaignId, status: { in: ["QUEUED","SENDING"] } },
          data:  reconcileData, // no suppressedCount
        });
        if (entUpdated.count === 0) {
          await prisma.sellerCampaign.updateMany({
            where: { id: campaignId, status: { in: ["QUEUED","SENDING"] } },
            data:  sellerReconcileData, // includes suppressedCount
          });
        }
      }
    }
  }

  return Response.json({ processed: jobs.length, sent, failed, skipped });
}

// Vercel Cron invokes scheduled paths with GET (see vercel.json). Exporting
// only POST meant this job returned 405 and never ran on schedule.
export const GET = POST;
