/**
 * POST /api/payments/withdraw/:id/cancel
 * The owner cancels a withdrawal that hasn't been approved yet; the money
 * returns to their wallet balance.
 */
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { WalletError } from "@/lib/wallet.js";
import { cancelWithdrawalByUser } from "@/lib/withdrawals.js";
import { logger } from "@/lib/sentry.js";

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  try {
    const withdrawal = await cancelWithdrawalByUser(params.id, auth.user.id);
    return ok({ withdrawal, message: "Withdrawal cancelled. The money is back in your wallet." });
  } catch (e) {
    if (e instanceof WalletError) return err(e.message, e.status);
    logger.error("[Withdraw] Cancel failed", { userId: auth.user.id, withdrawalId: params.id, error: e?.message });
    return err("Couldn't cancel the withdrawal. Please try again.", 500);
  }
}
