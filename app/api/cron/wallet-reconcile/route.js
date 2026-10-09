/**
 * GET|POST /api/cron/wallet-reconcile
 * Resolves wallet → subscription credits stuck in PENDING (process crash or
 * ambiguous Stripe error) by retrying with the original idempotency key.
 * Scheduled every 10 minutes in vercel.json. Requires Authorization: Bearer $CRON_SECRET.
 */
import { ok, err } from "@/lib/auth.js";
import { verifyCronRequest } from "@/lib/secrets.js";
import { reconcilePendingWalletTransactions } from "@/lib/wallet.js";
import { alertCritical } from "@/lib/sentry.js";

export async function POST(request) {
  if (!verifyCronRequest(request)) return err("Unauthorized", 401);
  try {
    const result = await reconcilePendingWalletTransactions();
    return ok({ result });
  } catch (e) {
    await alertCritical("Wallet reconciliation job failed", { error: e?.message });
    return err("Wallet reconciliation failed", 500);
  }
}

export const GET = POST;
