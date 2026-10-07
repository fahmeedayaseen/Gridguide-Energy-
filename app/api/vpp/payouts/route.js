import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { resolveVppRevenueSplit } from "@/lib/vpp-revenue-rules.js";
import { depositToWallet } from "@/lib/wallet.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";
import { z } from "zod";

// Legacy manual batch-payout path for the legacy VppEvent model — an admin
// pastes in each participant's kWh dispatched and this computes/pays out
// pro-rata shares of an admin-entered utility payment. Superseded by
// POST /api/vpp/revenue, which settles a single homeowner's real partner-
// reported VPP participation and deposits cash automatically. Gated behind
// ENABLE_LEGACY_VPP_DISPATCH.

const processPayoutsSchema = z.object({
  eventId:    z.string(),
  eventData:  z.array(z.object({
    userId:        z.string(),
    kwhDispatched: z.number().positive(),
  })),
});

const MIN_PAYOUT = 1.00; // minimum $1 payout per event

// GET /api/vpp/payouts — admin: get all payouts for an event
export async function GET(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const eventId = searchParams.get("eventId");
  if (!eventId) return err("eventId required", 400);

  const payouts = await prisma.vppPayout.findMany({
    where: { eventId },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { kwhDispatched: "desc" },
  });

  const summary = {
    total:       payouts.length,
    totalKwh:    payouts.reduce((s, p) => s + p.kwhDispatched, 0),
    totalNet:    payouts.reduce((s, p) => s + p.netAmount, 0),
    pending:     payouts.filter((p) => p.status === "PENDING").length,
    paid:        payouts.filter((p) => p.status === "PAID").length,
  };

  return ok({ payouts, summary });
}

/**
 * POST /api/vpp/payouts — admin: process batch payouts for an event.
 *
 * Each homeowner's split (homeowner / GridGuide / managing partner) is now
 * resolved via the configurable VppRevenueRule rule table (see
 * lib/vpp-revenue-rules.js) instead of a single hardcoded installer-plan
 * lookup — an enterprise org managing the property, an installer referral,
 * a specific VPP program, or a specific utility can each have their own
 * negotiated split, configurable by an admin without a code change.
 *
 * Net proceeds are deposited as real cash to the homeowner's wallet, and
 * to the managing partner's wallet (installer or enterprise org owner) when
 * a partner share applies. Installer earnings are also recorded in
 * InstallerVppEarning (aggregated per installer per event) — this table
 * already existed and is read by the installer-facing revenue/earnings
 * pages, but nothing previously wrote to it; only a wallet deposit happened,
 * so those pages would have shown nothing despite installers actually
 * having been paid.
 */
export async function POST(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, processPayoutsSchema);
  if (error) return err("Validation failed", 400, error);

  const { eventId, eventData } = data;

  const event = await prisma.vppEvent.findUnique({ where: { id: eventId } });
  if (!event) return err("VPP event not found", 404);
  if (event.status === "PAID") return err("Payouts already processed for this event", 409);

  const totalKwh = eventData.reduce((s, d) => s + d.kwhDispatched, 0);

  const payoutRecords = [];
  // Aggregated per-partner totals for this event, keyed by "TYPE:id"
  const partnerTotals = {}; // { key: { partnerType, partnerId, partnerUserId, amount, participatingHomes } }

  for (const participant of eventData) {
    const sharePct = participant.kwhDispatched / totalKwh;
    const grossAmount = event.utilityPayment * sharePct;

    const split = await resolveVppRevenueSplit({
      userId: participant.userId,
      vppProgram: event.program,
      utility: event.utility,
    });

    const fee            = grossAmount * split.gridguidePct;
    const partnerAmount  = grossAmount * split.partnerPct;
    const netAmount       = grossAmount - fee - partnerAmount; // homeowner's share

    if (netAmount < MIN_PAYOUT) continue;

    const enrollment = await prisma.vppEnrollment.findUnique({ where: { userId: participant.userId } });
    if (!enrollment) continue;

    payoutRecords.push({
      userId: participant.userId, eventId, enrollmentId: enrollment.id,
      kwhDispatched: participant.kwhDispatched, sharePct, grossAmount, fee, netAmount,
      status: "PENDING",
      partnerType: split.partnerType, partnerId: split.partnerId,
      partnerUserId: split.partnerUserId, partnerAmount, splitSource: split.source,
    });

    if (split.partnerType && partnerAmount > 0) {
      const key = `${split.partnerType}:${split.partnerId}`;
      if (!partnerTotals[key]) partnerTotals[key] = { partnerType: split.partnerType, partnerId: split.partnerId, partnerUserId: split.partnerUserId, amount: 0, participatingHomes: 0 };
      partnerTotals[key].amount += partnerAmount;
      partnerTotals[key].participatingHomes += 1;
    }
  }

  // Persist VppPayout rows (homeowner-facing; strip the partner-routing
  // fields the model doesn't store — those are used below for wallet/ledger
  // routing only, not part of VppPayout's own schema).
  await prisma.vppPayout.createMany({
    data: payoutRecords.map(({ partnerType, partnerId, partnerUserId, partnerAmount, splitSource, ...row }) => row),
  });

  let successCount = 0, failCount = 0;
  for (const record of payoutRecords) {
    try {
      await depositToWallet(record.userId, record.netAmount, "vpp_event", { eventId, kwhDispatched: record.kwhDispatched });

      await prisma.vppPayout.updateMany({ where: { eventId, userId: record.userId }, data: { status: "PAID", settledAt: new Date() } });
      successCount++;

      await prisma.notification.create({
        data: {
          userId: record.userId, type: "VPP_PAYOUT", title: "VPP Earnings Deposited",
          message: `Your VPP event earnings of $${record.netAmount.toFixed(2)} have been added to your GridGuide cash wallet.`,
          data: { eventId, netAmount: record.netAmount },
        },
      }).catch(() => {});
    } catch (e) {
      console.error("[VPP Payouts] Deposit failed for", record.userId, e.message);
      await prisma.vppPayout.updateMany({ where: { eventId, userId: record.userId }, data: { status: "FAILED" } });
      failCount++;
    }
  }

  // Pay out each managing partner's aggregated share for this event.
  for (const { partnerType, partnerId, partnerUserId, amount, participatingHomes } of Object.values(partnerTotals)) {
    if (!partnerUserId || amount <= 0) continue;
    try {
      await depositToWallet(partnerUserId, amount, "vpp_event", { eventId, role: partnerType.toLowerCase(), participatingHomes });

      if (partnerType === "INSTALLER") {
        await prisma.installerVppEarning.create({
          data: {
            installerId: partnerId, vppEventId: eventId,
            participatingHomes, utilityPayment: event.utilityPayment,
            installerShare: amount, status: "PAID", paidAt: new Date(),
          },
        }).catch((e) => console.error("[VPP Payouts] InstallerVppEarning record failed:", e.message));
      } else if (partnerType === "ENTERPRISE") {
        await prisma.enterpriseAuditLog.create({
          data: {
            orgId: partnerId, action: "VPP_REVENUE_SHARE_PAID",
            metadata: { eventId, amount, participatingHomes },
          },
        }).catch(() => {});
      }

      await prisma.notification.create({
        data: {
          userId: partnerUserId, type: "VPP_PAYOUT", title: "VPP Revenue Share Deposited",
          message: `$${amount.toFixed(2)} from ${participatingHomes} participating home${participatingHomes !== 1 ? "s" : ""} has been added to your GridGuide cash wallet.`,
          data: { eventId, amount },
        },
      }).catch(() => {});
    } catch (e) {
      console.error(`[VPP Payouts] Partner deposit failed for ${partnerType}:${partnerId}`, e.message);
    }
  }

  await prisma.vppEvent.update({
    where: { id: eventId },
    data: { status: "PAID", totalKwh, participantCount: payoutRecords.length },
  });

  return ok({
    message: "VPP batch payouts processed. Earnings deposited to homeowner and partner cash wallets.",
    totalPayouts: payoutRecords.length, successCount, failCount,
    totalNetPaid: payoutRecords.reduce((s, p) => s + p.netAmount, 0),
    totalPartnerPaid: Object.values(partnerTotals).reduce((s, p) => s + p.amount, 0),
  });
}
