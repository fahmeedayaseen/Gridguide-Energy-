/**
 * GET /api/rewards/wallet
 * Returns the logged-in homeowner's credit balance, dollar equivalent, and
 * the monthly $2.50 subscription-redemption cap status. This cap applies
 * only to credits redeemed toward the subscription — donations to the Grid
 * Fund and other redemption types are not capped and don't appear here.
 */
import { ok, err }                from "@/lib/auth.js";
import { authenticateRequest }    from "@/lib/jwt.js";
import { getCreditBalance, getMonthlyRedeemedCredits } from "@/lib/credits.js";
import { getPlatformConfig }      from "@/lib/platform-config.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const cfg = await getPlatformConfig();
  const wallet = await getCreditBalance(auth.user.id);

  const now = new Date();
  const redeemedThisMonth = await getMonthlyRedeemedCredits(auth.user.id, now.getMonth() + 1, now.getFullYear());
  const capRemaining = Math.max(0, cfg.monthlyRedemptionCapCredits - redeemedThisMonth);

  return ok({
    balance:            wallet.credits,
    dollarValue:        wallet.dollarValue,
    lifetimeEarned:     wallet.lifetimeEarned,
    lifetimeRedeemed:   wallet.lifetimeRedeemed,
    creditsPerDollar:   cfg.creditsPerDollar,
    gridFundDonationBonusPct: cfg.gridFundDonationBonusPct,
    monthlyCap: {
      capCredits:      cfg.monthlyRedemptionCapCredits,
      capDollars:      cfg.monthlyRedemptionCapDollars,
      redeemedCredits: redeemedThisMonth,
      remainingCredits: capRemaining,
      remainingDollars: Math.round((capRemaining / cfg.creditsPerDollar) * 100) / 100,
    },
  });
}
