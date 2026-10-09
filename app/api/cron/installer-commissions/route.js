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
import { verifyCronRequest }         from "@/lib/secrets.js";

export async function POST(request) {
  if (!verifyCronRequest(request)) return err("Unauthorized", 401);

  const result = await runMonthlyCommissionBatch();

  return ok({
    message: `Processed ${result.processedCount} installer referrals.`,
    totalCommission: Math.round(result.totalCommission * 100) / 100,
    processedCount:  result.processedCount,
  });
}

// Vercel Cron invokes scheduled paths with GET (see vercel.json). Exporting
// only POST meant this job returned 405 and never ran on schedule.
export const GET = POST;
