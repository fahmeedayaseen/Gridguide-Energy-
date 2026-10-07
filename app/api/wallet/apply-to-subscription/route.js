/**
 * POST /api/wallet/apply-to-subscription
 * Apply cash wallet balance toward the homeowner's subscription. This is
 * the homeowner's own real money (VPP earnings, etc.) — unlike GridGuide
 * Credits redemption, there is NO monthly cap on applying wallet cash to
 * the subscription; it's their money to use however they choose.
 *
 * Body: { amount: number }
 */
import { prisma }                   from "@/lib/db.js";
import { ok, err, parseBody }       from "@/lib/auth.js";
import { authenticateRequest }      from "@/lib/jwt.js";
import { applyWalletToSubscription } from "@/lib/wallet.js";
import { stripe }                   from "@/lib/stripe.js";
import { z }                        from "zod";

const schema = z.object({ amount: z.number().positive() });

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  try {
    const updated = await applyWalletToSubscription(auth.user.id, data.amount);

    const user = await prisma.user.findUnique({
      where:  { id: auth.user.id },
      select: { stripeCustomerId: true },
    });
    if (user?.stripeCustomerId) {
      try {
        await stripe.invoiceItems.create({
          customer:    user.stripeCustomerId,
          amount:      -Math.round(data.amount * 100),
          currency:    "usd",
          description: `GridGuide wallet balance applied to subscription`,
        });
      } catch (e) {
        console.error("[Wallet→Subscription] Stripe invoice item failed:", e.message);
      }
    }

    return ok({
      message: `$${data.amount.toFixed(2)} applied toward your subscription.`,
      amountApplied:    data.amount,
      remainingBalance: updated.balance,
    });
  } catch (e) {
    return err(e.message, 400);
  }
}
