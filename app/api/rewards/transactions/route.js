/**
 * GET /api/rewards/transactions
 * Returns the logged-in homeowner's credit transaction history
 * (earns and redemptions) for the Rewards Wallet UI.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err }             from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { ensureCreditAccount } from "@/lib/credits.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "30"));

  const account = await ensureCreditAccount(auth.user.id);

  const transactions = await prisma.creditTransaction.findMany({
    where:   { creditAccountId: account.id },
    orderBy: { createdAt: "desc" },
    take:    limit,
  });

  const redemptions = await prisma.creditRedemption.findMany({
    where:   { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take:    12, // last year of monthly redemptions
  });

  return ok({
    transactions: transactions.map(t => ({
      id:        t.id,
      amount:    t.amount,
      reason:    t.reason,
      label:     reasonLabel(t.reason, t.metadata),
      metadata:  t.metadata,
      createdAt: t.createdAt,
    })),
    redemptionHistory: redemptions.map(r => ({
      id:              r.id,
      periodMonth:     r.periodMonth,
      periodYear:      r.periodYear,
      creditsRedeemed: r.creditsRedeemed,
      dollarValue:     r.dollarValue,
      appliedTo:       r.appliedTo,
      status:          r.status,
      createdAt:       r.createdAt,
    })),
  });
}

function reasonLabel(reason, metadata) {
  if (reason === "redemption") {
    const appliedTo = metadata?.appliedTo;
    const redemptionLabels = {
      subscription:      "Redeemed toward subscription",
      donate_grid_fund:  "Donated to Community Solar Fund",
      gift_card:         "Redeemed for gift card",
    };
    return redemptionLabels[appliedTo] || "Redeemed";
  }
  const labels = {
    referral_signup:      "Referral bonus — friend signed up",
    referral_subscribed:  "Referral bonus — friend subscribed",
    donation_bonus:        "Grid Fund donation bonus",
    promo:                 "Promotional credit",
    admin_adjustment:      "Account adjustment",
  };
  return labels[reason] || reason;
}
