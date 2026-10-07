/**
 * POST /api/cron/installer-commissions
 * Scheduled job (call from Vercel Cron or similar) that recalculates
 * commission for every active installer referral using each installer's
 * CURRENT plan tier. Safe to run multiple times per month — upserts.
 *
 * Protect with CRON_SECRET header in production.
 */
import { ok, err }                   from "@/lib/auth.js";
import { runMonthlyCommissionBatch } from "@/lib/installer-commission.js";
import { requireSecret, IS_PROD }    from "@/lib/secrets.js";

export async function POST(request) {
  let secret;
  try {
    secret = requireSecret("CRON_SECRET");
  } catch {
    return err("Server misconfigured — this job cannot run without CRON_SECRET set.", 500);
  }
  const authHeader = request.headers.get("authorization");
  if (secret ? authHeader !== `Bearer ${secret}` : IS_PROD) {
    return err("Unauthorized", 401);
  }

  const result = await runMonthlyCommissionBatch();

  return ok({
    message: `Processed ${result.processedCount} installer referrals.`,
    totalCommission: Math.round(result.totalCommission * 100) / 100,
    processedCount:  result.processedCount,
  });
}
