/**
 * GridGuide Background Jobs
 * 
 * Deploy with Vercel Cron (vercel.json) or a standalone Node worker.
 * Each function is independently callable from /api/cron/[job] endpoints.
 */
import { prisma } from "./db.js";
import { transferToSeller, transferToInstaller } from "./stripe.js";
import { sendSellerPayout, sendWeeklyDigest } from "./email.js";
import { logAudit } from "./audit.js";
import axios from "axios";

// ─── 1. Bi-weekly seller payout processing ────────────────────────────────────
export async function processBiweeklySellerPayouts() {
  const now = new Date();
  console.log("[Cron] processBiweeklySellerPayouts started");

  const pendingPayouts = await prisma.sellerPayout.findMany({
    where: {
      status:      "PENDING",
      scheduledFor: { lte: now },
    },
    include: {
      seller: true,
      order:  true,
    },
  });

  let success = 0, failed = 0;

  for (const payout of pendingPayouts) {
    if (!payout.seller.stripeAccountId) {
      console.log(`[Cron] Skipping seller ${payout.sellerId} — no Stripe account`);
      continue;
    }

    try {
      const transfer = await transferToSeller({
        stripeAccountId: payout.seller.stripeAccountId,
        amount:          payout.netAmount,
        metadata:        { payoutId: payout.id, orderId: payout.orderId, type: "seller_payout" },
      });

      await prisma.sellerPayout.update({
        where: { id: payout.id },
        data:  { status: "PAID", stripeTransferId: transfer.id, settledAt: now },
      });

      // Update seller totals
      await prisma.seller.update({
        where: { id: payout.sellerId },
        data:  { totalPayouts: { increment: payout.netAmount } },
      });

      await sendSellerPayout(payout.seller, payout);
      success++;
    } catch (err) {
      console.error(`[Cron] Seller payout ${payout.id} failed:`, err.message);
      await prisma.sellerPayout.update({
        where: { id: payout.id },
        data:  { status: "FAILED" },
      });
      failed++;
    }
  }

  console.log(`[Cron] Seller payouts: ${success} success, ${failed} failed`);
  return { success, failed, total: pendingPayouts.length };
}

// ─── 2. Thermostat AI optimizer ───────────────────────────────────────────────
// Runs every 30 min — checks upcoming VPP events, pre-conditions enrolled homes
export async function thermostatAiOptimizer() {
  console.log("[Cron] thermostatAiOptimizer started");

  // Find upcoming VPP events starting in the next 60 minutes
  const now        = new Date();
  const in60min    = new Date(now.getTime() + 60 * 60 * 1000);
  const in45min    = new Date(now.getTime() + 45 * 60 * 1000);

  const upcomingEvents = await prisma.vppEvent.findMany({
    where: {
      status:      "SCHEDULED",
      windowStart: { gte: now, lte: in60min },
    },
  });

  if (!upcomingEvents.length) {
    console.log("[Cron] No upcoming VPP events in next 60 min");
    return { preconditioned: 0 };
  }

  // Find all enrolled homeowners with AI-optimize enabled thermostats
  const thermostats = await prisma.thermostat.findMany({
    where: {
      aiOptimize:      true,
      vppPreCondition: true,
      user: {
        vppEnrollment: { active: true },
      },
    },
    include: { user: true },
  });

  let preconditioned = 0;

  for (const thermo of thermostats) {
    try {
      // Calculate pre-conditioning target (cool 3°F below comfort setpoint)
      const preConditionTemp = (thermo.targetTemp || 72) - 3;

      // Send command to thermostat API
      await axios.post(
        `https://api.derapi.com/v1/devices/${thermo.externalId}/command`,
        { setpoint: preConditionTemp, mode: "cool" },
        { headers: { Authorization: `Bearer ${process.env.DERAPI_THERMOSTAT_KEY}` } }
      );

      await prisma.thermostat.update({
        where: { id: thermo.id },
        data:  { targetTemp: preConditionTemp, lastSyncAt: new Date() },
      });

      // Notify homeowner
      const event = upcomingEvents[0];
      await prisma.notification.create({
        data: {
          userId:  thermo.userId,
          type:    "VPP_PRECONDITION",
          title:   "GridGuide AI Pre-conditioning Your Home",
          message: `VPP event starts at ${new Date(event.windowStart).toLocaleTimeString()}. GridGuide AI pre-cooled your home to ${preConditionTemp}°F to maximize your comfort and earnings.`,
          data:    { eventId: event.id, preConditionTemp },
        },
      });

      preconditioned++;
    } catch (err) {
      console.error(`[Cron] Pre-condition failed for thermostat ${thermo.id}:`, err.message);
    }
  }

  console.log(`[Cron] Pre-conditioned ${preconditioned} homes`);
  return { preconditioned };
}

// ─── 3. Device telemetry sync (solar, battery, EV) ───────────────────────────
export async function syncDeviceTelemetry() {
  const devices = await prisma.device.findMany({
    where: { status: "ACTIVE", derApiId: { not: null } },
  });

  let synced = 0;

  for (const device of devices) {
    try {
      const res = await axios.get(
        `https://api.derapi.com/v1/devices/${device.derApiId}/telemetry`,
        { headers: { Authorization: `Bearer ${process.env.DERAPI_KEY}` }, timeout: 5000 }
      );

      await prisma.device.update({
        where: { id: device.id },
        data:  { lastReading: res.data, lastSeenAt: new Date() },
      });

      await prisma.deviceReading.create({
        data: { deviceId: device.id, reading: res.data },
      }).catch(() => {}); // history is additive/best-effort — never block the sync loop on it

      synced++;
    } catch {
      // Non-critical — just mark as not seen recently
    }
  }

  console.log(`[Cron] Synced ${synced}/${devices.length} devices`);
  return { synced, total: devices.length };
}

// ─── 4. Weekly energy digest email ────────────────────────────────────────────
// ─── Phase 3: expire sponsorship grace periods ────────────────────────────────
// getEffectivePlan() already stops honoring a sponsorship once
// gracePeriodEndsAt passes, purely from the date comparison - this job
// doesn't change plan access, it finalizes the record and notifies the
// homeowner their grace period has actually lapsed.
export async function expireSponsorshipGracePeriods() {
  const expired = await prisma.enterpriseSponsorship.findMany({
    where: { status: "ENDED", gracePeriodEndsAt: { lte: new Date() } },
    include: { org: { select: { name: true } } },
  });

  let notified = 0;
  for (const sponsorship of expired) {
    await prisma.enterpriseSponsorship.update({ where: { id: sponsorship.id }, data: { status: "EXPIRED" } });

    await prisma.notification.create({
      data: {
        userId: sponsorship.userId, type: "ENTERPRISE_SPONSORSHIP_EXPIRED",
        title: "Sponsored plan has ended",
        message: `Your ${sponsorship.org.name}-sponsored plan has ended. You're now on your own plan.`,
        data: { orgName: sponsorship.org.name },
      },
    }).catch(() => {});

    await logAudit({
      action: "SPONSORSHIP_GRACE_PERIOD_EXPIRED", targetType: "EnterpriseSponsorship",
      targetId: sponsorship.id, orgId: sponsorship.orgId, category: "BILLING",
      metadata: { userId: sponsorship.userId },
    });
    notified++;
  }

  console.log(`[Cron] Expired ${notified} sponsorship grace period(s)`);
  return { notified };
}

export async function sendWeeklyDigests() {
  const users = await prisma.user.findMany({
    where: { plan: "HOMEOWNER_PLUS", emailVerified: true },
    include: {
      devices: { where: { type: "SOLAR_INVERTER" } },
      vppEnrollment: true,
    },
  });

  let sent = 0;
  for (const user of users) {
    // In production: pull real data from device readings
    const stats = {
      solarKwh:    28.4,
      consumedKwh: 21.1,
      vppEarnings: 12.40,
      savings:     34.20,
    };
    try {
      await sendWeeklyDigest(user, stats);
      sent++;
    } catch {}
  }

  return { sent };
}

// ─── 5. VPP event auto-transition ─────────────────────────────────────────────
export async function updateVppEventStatuses() {
  const now = new Date();

  // Activate events that have started
  await prisma.vppEvent.updateMany({
    where: { status: "SCHEDULED", windowStart: { lte: now }, windowEnd: { gt: now } },
    data:  { status: "ACTIVE" },
  });

  // Complete events that have ended (waiting for utility data)
  await prisma.vppEvent.updateMany({
    where: { status: "ACTIVE", windowEnd: { lte: now } },
    data:  { status: "COMPLETED" },
  });

  console.log("[Cron] VPP event statuses updated");
}
