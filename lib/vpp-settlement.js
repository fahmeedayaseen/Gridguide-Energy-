import { computeRevenueSplit } from "@/lib/vpp-partners.js";
import { getVppSplit } from "@/lib/platform-config.js";
import { depositToWallet } from "@/lib/wallet.js";

/**
 * Settle one homeowner's VPP event participation: resolve the installer-plan
 * split, verify referral eligibility, record the VppRevenueSplit ledger row,
 * and deposit real cash to the homeowner's (and eligible installer's) wallet.
 *
 * This is the single source of truth for VPP settlement math — both
 * POST /api/vpp/revenue (single participant, admin-triggered) and
 * POST /api/vpp/events/partner/[id]/settlement (batch import) call this,
 * so there is exactly one place the split percentages and eligibility rule
 * are implemented.
 *
 * Idempotent and retry-safe: a row only counts as settled once its wallet
 * deposit(s) actually succeed. Re-running for the same eventId+enrollmentId
 * never double-deposits cash a deposit that already succeeded — but if a
 * previous attempt's deposit FAILED, re-running retries it rather than
 * silently treating the row as done. The split's status only becomes
 * DEPOSITED once every applicable deposit (homeowner, and installer if
 * eligible) has actually succeeded; if either fails, the row is marked
 * FAILED and callers can see exactly which side failed and why.
 *
 * @returns {object} { record, installerPlanApplied, splitPercentages, alreadyDeposited, depositFailed, depositError }
 * @throws if the enrollment doesn't exist — caller decides how to report that
 */
export async function settleVppParticipant(prisma, { eventId, enrollmentId, grossAmount, metadata = null }) {
  const enrollment = await prisma.vppProgramEnrollment.findUnique({
    where: { id: enrollmentId },
    include: { program: true },
  });
  if (!enrollment) {
    const e = new Error(`Enrollment ${enrollmentId} not found`);
    e.code = "VPP_ENROLLMENT_NOT_FOUND";
    throw e;
  }

  // ── Eligibility check: is there an active referring installer? ───────────
  // Only counts if the homeowner is still linked to that installer and the
  // relationship is currently active — prevents disputes if the homeowner
  // later switched installers or was never referred by one at all.
  const activeReferral = await prisma.installerReferral.findFirst({
    where: {
      userId: enrollment.userId,
      conversionStatus: { in: ["subscribed", "activated"] },
      verified: true,
    },
    include: { installer: { select: { id: true, plan: true, userId: true } } },
    orderBy: { referredAt: "desc" },
  });

  const installerPlan = activeReferral?.installer?.plan ?? null;
  const vppSplit = await getVppSplit(installerPlan);

  const split = computeRevenueSplit(grossAmount, {
    gridguideFeePct: vppSplit.gridguide,
    installerSharePct: vppSplit.installer,
  });

  const existing = await prisma.vppRevenueSplit.findUnique({ where: { eventId_enrollmentId: { eventId, enrollmentId } } });

  const record = await prisma.vppRevenueSplit.upsert({
    where: { eventId_enrollmentId: { eventId, enrollmentId } },
    update: { ...split, installerId: activeReferral?.installer?.id ?? null, metadata },
    create: { eventId, enrollmentId, userId: enrollment.userId, installerId: activeReferral?.installer?.id ?? null, ...split, metadata },
  });

  // A row only counts as "already deposited" if a PRIOR attempt actually
  // succeeded (DEPOSITED or later). CALCULATED (never attempted) and FAILED
  // (attempted, didn't fully succeed) both need a deposit attempt — this is
  // what makes a failed deposit retryable instead of stuck.
  const alreadySettled = existing && !["CALCULATED", "FAILED"].includes(existing.status);
  let depositFailed = false;
  let depositError = null;

  if (!alreadySettled) {
    let homeownerOk = true, installerOk = true;
    if (split.homeownerAmount > 0) {
      try {
        await depositToWallet(enrollment.userId, split.homeownerAmount, "vpp_event", {
          eventId, enrollmentId, vppRevenueSplitId: record.id,
        });
      } catch (e) {
        homeownerOk = false;
        depositError = `Homeowner deposit failed: ${e.message}`;
        console.error("[VPP Settlement] Homeowner wallet deposit failed:", e.message);
      }
    }
    if (activeReferral?.installer && split.installerAmount > 0) {
      try {
        await depositToWallet(activeReferral.installer.userId, split.installerAmount, "vpp_event", {
          eventId, enrollmentId, vppRevenueSplitId: record.id, referredHomeownerId: enrollment.userId,
        });
      } catch (e) {
        installerOk = false;
        depositError = depositError ? `${depositError}; Installer deposit failed: ${e.message}` : `Installer deposit failed: ${e.message}`;
        console.error("[VPP Settlement] Installer wallet deposit failed:", e.message);
      }
    }

    depositFailed = !homeownerOk || !installerOk;

    await prisma.vppRevenueSplit.update({
      where: { id: record.id },
      data: { status: depositFailed ? "FAILED" : "DEPOSITED", metadata: depositFailed ? { ...(metadata || {}), depositError } : metadata },
    }).catch(() => {});
    record.status = depositFailed ? "FAILED" : "DEPOSITED";

    // Only notify for the side(s) that actually succeeded — a failed deposit
    // must never tell someone money landed in their wallet when it didn't.
    if (homeownerOk && split.homeownerAmount > 0) {
      await prisma.notification.create({
        data: {
          userId: enrollment.userId,
          type: "VPP_PAYOUT",
          title: "VPP Earnings Deposited",
          message: `Your VPP event earnings of $${split.homeownerAmount.toFixed(2)} have been added to your GridGuide cash wallet.`,
          data: { eventId, netAmount: split.homeownerAmount },
        },
      }).catch(() => {});
    }
    if (installerOk && activeReferral?.installer && split.installerAmount > 0) {
      await prisma.notification.create({
        data: {
          userId: activeReferral.installer.userId,
          type: "VPP_REVENUE_SHARE",
          title: "VPP event earnings",
          message: `You earned $${split.installerAmount.toFixed(2)} (${Math.round(vppSplit.installer * 100)}%) from a referred homeowner's VPP event participation. Funds have been added to your cash wallet.`,
        },
      }).catch(() => {});
    }
  }

  return {
    record,
    installerPlanApplied: installerPlan,
    splitPercentages: { homeowner: vppSplit.homeowner, gridguide: vppSplit.gridguide, installer: vppSplit.installer },
    alreadyDeposited: alreadySettled,
    depositFailed,
    depositError,
  };
}

/**
 * Settle every participant in a batch (a partner's reported settlement file
 * or webhook payload for one event). Never throws for an individual
 * participant failure — collects per-participant results so the caller can
 * report exactly which ones succeeded/failed rather than aborting the whole
 * batch on one bad row.
 *
 * @param participants array of { enrollmentId?, externalEnrollmentId?, userId?, grossAmount }
 *   At least one of enrollmentId / externalEnrollmentId / userId must identify
 *   the enrollment. externalEnrollmentId is what a partner's own settlement
 *   file will reference; userId is a convenience for admin-typed imports.
 */
export async function settleVppEventBatch(prisma, { eventId, participants, metadata = null }) {
  const results = [];
  for (const p of participants) {
    try {
      let enrollmentId = p.enrollmentId || null;
      if (!enrollmentId && p.externalEnrollmentId) {
        const match = await prisma.vppProgramEnrollment.findFirst({ where: { externalEnrollmentId: p.externalEnrollmentId } });
        if (!match) throw Object.assign(new Error(`No enrollment found for externalEnrollmentId ${p.externalEnrollmentId}`), { code: "VPP_ENROLLMENT_NOT_FOUND" });
        enrollmentId = match.id;
      }
      if (!enrollmentId && p.userId) {
        const match = await prisma.vppProgramEnrollment.findFirst({ where: { userId: p.userId, status: { in: ["ACTIVE", "PENDING_PROVIDER"] } }, orderBy: { enrolledAt: "desc" } });
        if (!match) throw Object.assign(new Error(`No active enrollment found for userId ${p.userId}`), { code: "VPP_ENROLLMENT_NOT_FOUND" });
        enrollmentId = match.id;
      }
      if (!enrollmentId) throw Object.assign(new Error("Participant row missing enrollmentId, externalEnrollmentId, or userId"), { code: "VPP_PARTICIPANT_UNRESOLVED" });
      if (!(p.grossAmount > 0)) throw Object.assign(new Error("grossAmount must be a positive number"), { code: "VPP_INVALID_AMOUNT" });

      const settled = await settleVppParticipant(prisma, { eventId, enrollmentId, grossAmount: p.grossAmount, metadata });
      results.push({ ok: true, enrollmentId, input: p, ...settled });
    } catch (e) {
      results.push({ ok: false, input: p, error: e.message, code: e.code || "VPP_SETTLEMENT_FAILED" });
    }
  }

  const totals = results.reduce((a, r) => {
    if (!r.ok) return a;
    return {
      grossAmount: a.grossAmount + r.record.grossAmount,
      homeownerAmount: a.homeownerAmount + r.record.homeownerAmount,
      gridguideAmount: a.gridguideAmount + r.record.gridguideAmount,
      installerAmount: a.installerAmount + r.record.installerAmount,
    };
  }, { grossAmount: 0, homeownerAmount: 0, gridguideAmount: 0, installerAmount: 0 });

  // "ok" means the row was resolved and recorded — it does NOT mean cash
  // actually moved. depositFailedCount tracks rows where the ledger entry
  // was created/recalculated but the wallet deposit itself failed (status
  // FAILED, not DEPOSITED) — these need admin attention and are safe to
  // retry by re-importing/re-running settlement for the same event.
  const depositFailedCount = results.filter(r => r.ok && r.depositFailed).length;

  return {
    results,
    successCount: results.filter(r => r.ok).length,
    failCount: results.filter(r => !r.ok).length,
    depositFailedCount,
    totals,
  };
}

/**
 * Recompute a VppPartnerEvent's grossRevenue as the sum of all its
 * VppRevenueSplit rows, and write that absolute total back — never
 * increment. Re-importing the same (or a corrected) settlement recalculates
 * each participant row via upsert rather than creating duplicates, so an
 * increment would double-count on every re-import; recomputing from the
 * ledger is idempotent no matter how many times settlement is (re-)run.
 */
export async function recomputeEventGrossRevenue(prisma, eventId) {
  const agg = await prisma.vppRevenueSplit.aggregate({
    where: { eventId },
    _sum: { grossAmount: true },
  });
  const grossRevenue = agg._sum.grossAmount || 0;
  await prisma.vppPartnerEvent.update({ where: { id: eventId }, data: { grossRevenue } }).catch(() => {});
  return grossRevenue;
}
