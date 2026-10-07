/**
 * POST /api/rewards/redeem
 * Redeem GridGuide Credits toward the subscription or gift cards. The
 * $2.50/month (2,500 credit) admin-configured cap applies ONLY to
 * subscription redemption.
 *
 * NOTE: Donations to the GridGuide Community Fund are a SEPARATE flow —
 * see POST /api/wallet/donate-grid-fund. Donations come from the cash
 * wallet (VPP earnings), not the Credits balance, so they are not handled
 * by this endpoint.
 *
 * Body: { credits: number, appliedTo?: "subscription"|"gift_card" }
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redeemCredits }       from "@/lib/credits.js";
import { stripe }              from "@/lib/stripe.js";
import { z }                   from "zod";

const schema = z.object({
  credits:   z.number().int().positive(),
  appliedTo: z.enum(["subscription", "gift_card"]).default("subscription"),
});

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  try {
    const result = await redeemCredits(auth.user.id, data.credits, data.appliedTo);

    // If applying to a live Stripe subscription, create an invoice credit item
    if (data.appliedTo === "subscription") {
      const user = await prisma.user.findUnique({
        where: { id: auth.user.id },
        select: { stripeCustomerId: true, stripeSubscriptionId: true },
      });
      if (user?.stripeCustomerId) {
        try {
          await stripe.invoiceItems.create({
            customer:    user.stripeCustomerId,
            amount:      -Math.round(result.dollarValue * 100), // negative = credit, in cents
            currency:    "usd",
            description: `GridGuide Rewards credit (${result.creditsRedeemed.toLocaleString()} credits)`,
          });
        } catch (e) {
          console.error("[Redeem] Stripe invoice item failed:", e.message);
        }
      }
    }

    const message = result.capped
      ? `Redeemed ${result.creditsRedeemed.toLocaleString()} credits ($${result.dollarValue.toFixed(2)}). Capped by monthly subscription limit — ${data.credits - result.creditsRedeemed} credits were not redeemed.`
      : `Redeemed ${result.creditsRedeemed.toLocaleString()} credits ($${result.dollarValue.toFixed(2)}) toward your ${data.appliedTo.replace("_", " ")}.`;

    return ok({
      message,
      creditsRedeemed:       result.creditsRedeemed,
      dollarValue:           result.dollarValue,
      capped:                result.capped,
      isCapped:              result.isCapped,
      remainingBalance:      result.account.balance,
      remainingCapThisMonth: result.remainingCapAfter,
    });
  } catch (e) {
    return err(e.message, 400);
  }
}
