/**
 * POST /api/wallet/apply-to-subscription
 * Apply cash wallet balance toward the homeowner's subscription. This is
 * the homeowner's own real money (VPP earnings, etc.) — unlike GridGuide
 * Credits redemption, there is NO monthly cap on applying wallet cash to
 * the subscription; it's their money to use however they choose.
 *
 * Body: { amount: number }
 * Optional header: Idempotency-Key — a retried/double-submitted request with
 * the same key applies the money only once.
 *
 * The wallet debit and the Stripe credit are two-phase (see
 * applyWalletToSubscription in lib/wallet.js): the debit can no longer
 * succeed while the Stripe credit fails.
 *
 * Responses:
 *   200 { status: "COMPLETED" } — credit is on the Stripe customer balance
 *   202 { status: "PENDING" }   — Stripe outcome unknown; resolves automatically
 *   4xx/502                    — nothing was taken from the wallet
 */
import { ok, err, parseBody }       from "@/lib/auth.js";
import { authenticateRequest }      from "@/lib/jwt.js";
import { applyWalletToSubscription, getWalletBalance, WalletError } from "@/lib/wallet.js";
import { logger }                   from "@/lib/sentry.js";
import { z }                        from "zod";

const schema = z.object({ amount: z.number().positive().max(100000) });

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const rawKey = request.headers.get("idempotency-key");
  const idempotencyKey = rawKey ? `${auth.user.id}:${rawKey.slice(0, 200)}` : undefined;

  try {
    const result = await applyWalletToSubscription(auth.user.id, data.amount, { idempotencyKey });
    const { balance } = await getWalletBalance(auth.user.id);

    if (result.status === "PENDING") {
      return ok({
        status: "PENDING",
        message: `$${result.amountApplied.toFixed(2)} is being applied to your subscription. This usually completes within a few minutes.`,
        amountApplied:    result.amountApplied,
        remainingBalance: balance,
      }, 202);
    }

    return ok({
      status: "COMPLETED",
      message: `$${result.amountApplied.toFixed(2)} applied toward your subscription.`,
      amountApplied:    result.amountApplied,
      remainingBalance: balance,
    });
  } catch (e) {
    if (e instanceof WalletError) return err(e.message, e.status);
    logger.error("[Wallet→Subscription] Unexpected failure", { userId: auth.user.id, error: e?.message });
    return err("Something went wrong applying your wallet balance. Please try again.", 500);
  }
}
