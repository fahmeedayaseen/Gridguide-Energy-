/**
 * GridGuide — Cash Wallet Engine
 *
 * Handles REAL MONEY: VPP event earnings, referral cash bonuses (if ever
 * offered), marketplace sales proceeds. This is intentionally separate from
 * lib/credits.js, which handles GridGuide Credits — the platform loyalty
 * currency used for engagement rewards (referrals, onboarding, device
 * connections, challenges) and redeemed for non-cash benefits (subscription
 * discounts, marketplace purchases, gift cards).
 *
 *   Cash Wallet  → real money, withdrawable via ACH/debit/PayPal/wire
 *   Credits      → loyalty points, redeemed for platform benefits only
 *
 * Cash wallet balance can be applied toward the subscription (homeowner's
 * choice, no cap — it's their own money), or donated to the GridGuide
 * Community Fund. Donating is the ONE place cash and credits intersect:
 * the donated dollars leave the cash wallet, and the homeowner earns 10%
 * of the donated dollar value back as GridGuide Credits as a thank-you.
 * This is a one-way conversion (cash → credit bonus); credits are never
 * converted back into cash.
 */
import { prisma } from "./db.js";
import { awardCredits } from "./credits.js";
import { getPlatformConfig } from "./platform-config.js";

/**
 * Ensure a user has a Wallet row, creating one if needed.
 */
export async function ensureWallet(userId) {
  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) {
    wallet = await prisma.wallet.create({ data: { userId } });
  }
  return wallet;
}

/**
 * Deposit real cash into a user's wallet (e.g. VPP event earnings,
 * marketplace sale proceeds). This is actual money, not loyalty credits.
 *
 * @param {string} userId
 * @param {number} amount - positive dollar amount
 * @param {string} source - "vpp_event" | "marketplace_sale" | "referral_cash_bonus" | "admin_adjustment"
 * @param {object} [metadata]
 */
export async function depositToWallet(userId, amount, source, metadata = {}) {
  if (amount <= 0) throw new Error("depositToWallet requires a positive amount");

  const wallet = await ensureWallet(userId);

  const updated = await prisma.wallet.update({
    where: { id: wallet.id },
    data: {
      balance:        { increment: amount },
      lifetimeEarned: { increment: amount },
    },
  });

  await prisma.notification.create({
    data: {
      userId,
      type:    "WALLET_DEPOSIT",
      title:   depositTitle(source),
      message: `$${amount.toFixed(2)} was added to your GridGuide cash wallet.`,
      data:    { source, amount, ...metadata },
    },
  }).catch(() => {});

  return updated;
}

function depositTitle(source) {
  const titles = {
    vpp_event:            "VPP event earnings deposited",
    marketplace_sale:     "Marketplace sale proceeds deposited",
    referral_cash_bonus:  "Referral cash bonus deposited",
    admin_adjustment:     "Wallet adjustment",
  };
  return titles[source] || "Wallet deposit";
}

/**
 * Get a user's current cash wallet balance.
 */
export async function getWalletBalance(userId) {
  const wallet = await ensureWallet(userId);
  return {
    balance:            wallet.balance,
    pendingWithdrawals: wallet.pendingWithdrawals,
    lifetimeEarned:     wallet.lifetimeEarned,
    available:          Math.max(0, wallet.balance - wallet.pendingWithdrawals),
  };
}

/**
 * Apply cash wallet balance toward the subscription (homeowner's choice,
 * separate from a bank/debit withdrawal). Unlike Credits redemption, this is
 * NOT capped — it's the homeowner's own real money, they can apply as much
 * of it as they want toward their bill.
 *
 * @param {string} userId
 * @param {number} amount - dollar amount to apply
 */
export async function applyWalletToSubscription(userId, amount) {
  if (amount <= 0) throw new Error("applyWalletToSubscription requires a positive amount");

  const wallet = await ensureWallet(userId);
  if (wallet.balance < amount) {
    throw new Error(`Insufficient wallet balance. Have $${wallet.balance.toFixed(2)}, requested $${amount.toFixed(2)}.`);
  }

  const updated = await prisma.wallet.update({
    where: { id: wallet.id },
    data:  { balance: { decrement: amount } },
  });

  return updated;
}

/**
 * Donate cash wallet balance (VPP earnings) to the GridGuide Community Fund.
 * This is the one place cash and Credits intersect: the donated dollars
 * leave the cash wallet, and the homeowner earns gridFundDonationBonusPct
 * (default 10%) of the donated dollar value back as GridGuide Credits.
 *
 * Donations are NOT capped by the $2.50/mo Credits redemption cap — that
 * cap only applies to redeeming Credits toward a subscription, which is an
 * entirely separate flow from this cash donation.
 *
 * @param {string} userId
 * @param {number} amount - dollar amount to donate from the cash wallet
 */
export async function donateToGridFund(userId, amount) {
  if (amount <= 0) throw new Error("donateToGridFund requires a positive amount");

  const cfg = await getPlatformConfig();
  if (amount < cfg.gridFundDonationMinDollars) {
    throw new Error(`Minimum Grid Fund donation is $${cfg.gridFundDonationMinDollars.toFixed(2)}.`);
  }

  const wallet = await ensureWallet(userId);
  if (wallet.balance < amount) {
    throw new Error(`Insufficient wallet balance. Have $${wallet.balance.toFixed(2)}, requested $${amount.toFixed(2)}.`);
  }

  // Bonus credits = 10% of the donated dollar value, converted at the
  // platform's creditsPerDollar rate (e.g. $10 donated × 10% = $1 worth
  // of credits = 1,000 credits at the default 1,000 credits/$1 rate).
  const bonusDollarValue = amount * cfg.gridFundDonationBonusPct;
  const bonusCredits = Math.round(bonusDollarValue * cfg.creditsPerDollar);

  const [updatedWallet, donation] = await prisma.$transaction([
    prisma.wallet.update({
      where: { id: wallet.id },
      data:  { balance: { decrement: amount } },
    }),
    prisma.gridFundDonation.create({
      data: { userId, amount, source: "cash_wallet", creditBonusAwarded: bonusCredits },
    }),
  ]);

  // Award the credit bonus via the Credits engine (separate ledger)
  if (bonusCredits > 0) {
    await awardCredits(userId, bonusCredits, "donation_bonus", { donationAmount: amount, donationId: donation.id }).catch(e => {
      console.error("[GridFund] Credit bonus award failed:", e.message);
    });
  }

  await prisma.notification.create({
    data: {
      userId,
      type:    "GRID_FUND_DONATION",
      title:   "Thank you for your donation! 🌱",
      message: `Your $${amount.toFixed(2)} donation is helping fund community solar. You earned ${bonusCredits.toLocaleString()} GridGuide Credits back.`,
      data:    { amount, bonusCredits, donationId: donation.id },
    },
  }).catch(() => {});

  return { wallet: updatedWallet, donation, bonusCredits };
}
