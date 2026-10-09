/**
 * POST /api/wallet/donate-grid-fund
 * Donate cash wallet balance (VPP earnings) to the GridGuide Community Fund.
 * The homeowner earns 10% of the donated dollar value back as GridGuide
 * Credits. Donations come from real cash, NOT from the Credits balance.
 *
 * Body: { amount: number } — dollar amount to donate
 */
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { donateToGridFund, WalletError } from "@/lib/wallet.js";
import { logger }              from "@/lib/sentry.js";
import { z }                   from "zod";

const schema = z.object({ amount: z.number().positive().max(100000) });

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  try {
    const result = await donateToGridFund(auth.user.id, data.amount);

    return ok({
      message: `Thank you! $${data.amount.toFixed(2)} donated to the GridGuide Community Fund. You earned ${result.bonusCredits.toLocaleString()} credits back.`,
      amountDonated:    data.amount,
      bonusCredits:     result.bonusCredits,
      remainingBalance: result.wallet.balance,
    });
  } catch (e) {
    if (e instanceof WalletError) return err(e.message, e.status);
    logger.error("[GridFund] Donation failed", { userId: auth.user.id, error: e?.message });
    return err("Something went wrong processing your donation. Please try again.", 500);
  }
}
