/**
 * GridGuide — Credit Wallet Engine
 *
 * Centralizes all credit earn/redeem logic so the rules (1,000 credits = $1,
 * 2,500-credit referral bonus, $2.50/mo redemption cap) are enforced in
 * exactly one place no matter which API route triggers them.
 */
import { prisma } from "./db.js";
import { getPlatformConfig, creditsToDollars } from "./platform-config.js";

/**
 * Ensure a user has a CreditAccount row, creating one if needed.
 */
export async function ensureCreditAccount(userId) {
  let account = await prisma.creditAccount.findUnique({ where: { userId } });
  if (!account) {
    account = await prisma.creditAccount.create({ data: { userId } });
  }
  return account;
}

/**
 * Award credits to a user's wallet and log the transaction.
 * @param {string} userId
 * @param {number} amount - positive integer
 * @param {string} reason - "referral_signup" | "referral_subscribed" | "promo" | "admin_adjustment"
 * @param {object} [metadata]
 */
export async function awardCredits(userId, amount, reason, metadata = {}) {
  if (amount <= 0) throw new Error("awardCredits requires a positive amount");

  const account = await ensureCreditAccount(userId);

  const [updated, txn] = await prisma.$transaction([
    prisma.creditAccount.update({
      where: { id: account.id },
      data: {
        balance:        { increment: amount },
        lifetimeEarned: { increment: amount },
      },
    }),
    prisma.creditTransaction.create({
      data: { creditAccountId: account.id, amount, reason, metadata },
    }),
  ]);

  return { account: updated, transaction: txn };
}

/**
 * Get a user's current credit balance and dollar-equivalent.
 */
export async function getCreditBalance(userId) {
  const account = await ensureCreditAccount(userId);
  const dollarValue = await creditsToDollars(account.balance);
  return { credits: account.balance, dollarValue, lifetimeEarned: account.lifetimeEarned, lifetimeRedeemed: account.lifetimeRedeemed };
}

/**
 * Get how many credits a user has already redeemed TOWARD THEIR SUBSCRIPTION
 * this calendar month. Only subscription redemptions count against the cap —
 * donations and other redemption types are tracked separately and uncapped.
 */
export async function getMonthlyRedeemedCredits(userId, month, year) {
  const existing = await prisma.creditRedemption.findUnique({
    where: { userId_periodMonth_periodYear: { userId, periodMonth: month, periodYear: year } },
  });
  return existing?.creditsRedeemed || 0;
}

/**
 * Redeem credits toward a target. The $2.50/month (2,500 credit) cap applies
 * ONLY when appliedTo === "subscription". Gift card redemption is NOT
 * subject to the monthly cap; the homeowner's full credit balance is
 * available for that at any time.
 *
 * NOTE: Grid Fund donations are a SEPARATE flow (see lib/wallet.js →
 * donateToGridFund) sourced from the cash wallet, not Credits, so they are
 * not handled by this function.
 *
 * @param {string} userId
 * @param {number} requestedCredits
 * @param {"subscription"|"gift_card"} appliedTo
 */
export async function redeemCredits(userId, requestedCredits, appliedTo = "subscription") {
  if (requestedCredits <= 0) throw new Error("redeemCredits requires a positive amount");

  const cfg = await getPlatformConfig();
  const now = new Date();
  const periodMonth = now.getMonth() + 1;
  const periodYear  = now.getFullYear();
  const isCapped = appliedTo === "subscription";

  const account = await ensureCreditAccount(userId);

  if (account.balance < requestedCredits) {
    throw new Error(`Insufficient credit balance. Have ${account.balance}, requested ${requestedCredits}.`);
  }

  let creditsToRedeem = requestedCredits;
  let remainingCap = null;

  if (isCapped) {
    const alreadyRedeemedThisMonth = await getMonthlyRedeemedCredits(userId, periodMonth, periodYear);
    remainingCap = Math.max(0, cfg.monthlyRedemptionCapCredits - alreadyRedeemedThisMonth);

    if (remainingCap <= 0) {
      throw new Error(`Monthly subscription redemption cap of ${cfg.monthlyRedemptionCapCredits} credits ($${cfg.monthlyRedemptionCapDollars}) already reached for this billing period.`);
    }
    creditsToRedeem = Math.min(requestedCredits, remainingCap);
  }

  const dollarValue = await creditsToDollars(creditsToRedeem);

  const ops = [
    prisma.creditAccount.update({
      where: { id: account.id },
      data: {
        balance:          { decrement: creditsToRedeem },
        lifetimeRedeemed: { increment: creditsToRedeem },
      },
    }),
    prisma.creditTransaction.create({
      data: { creditAccountId: account.id, amount: -creditsToRedeem, reason: "redemption", metadata: { appliedTo, periodMonth, periodYear } },
    }),
  ];

  // Only subscription redemptions write into the capped CreditRedemption
  // ledger — that's the row the monthly cap check reads from. Other
  // redemption types are fully recorded in CreditTransaction above (with
  // appliedTo in metadata) but never touch the cap.
  if (isCapped) {
    ops.push(
      prisma.creditRedemption.upsert({
        where: { userId_periodMonth_periodYear: { userId, periodMonth, periodYear } },
        update: {
          creditsRedeemed: { increment: creditsToRedeem },
          dollarValue:     { increment: dollarValue },
        },
        create: {
          userId, creditAccountId: account.id, periodMonth, periodYear,
          creditsRedeemed: creditsToRedeem, dollarValue, appliedTo, status: "APPLIED",
        },
      })
    );
  }

  const results = await prisma.$transaction(ops);
  const updatedAccount = results[0];

  return {
    creditsRedeemed: creditsToRedeem,
    dollarValue,
    capped: isCapped && creditsToRedeem < requestedCredits,
    remainingCapAfter: remainingCap !== null ? remainingCap - creditsToRedeem : null,
    isCapped,
    account: updatedAccount,
  };
}

/**
 * Award the one-time homeowner referral bonus (2,500 credits = $2.50 by default).
 * Idempotent per HomeownerReferral — call only once when status flips to "subscribed"
 * or "signed_up" depending on your reward trigger policy.
 */
export async function awardHomeownerReferralCredits(referrerId, homeownerReferralId) {
  const cfg = await getPlatformConfig();
  const amount = cfg.homeownerReferralCredits;

  return awardCredits(referrerId, amount, "referral_signup", { homeownerReferralId });
}

/**
 * awardOneTimeCredits — idempotent credit award backed by a RewardGrant row.
 *
 * This is the REQUIRED path for every reward that must only fire once:
 *   - device connect bonus (250 credits per device)
 *   - referral subscription bonus (2,500 credits)
 *   - home profile completion (300 credits)
 *   - rebate submission (100 credits)
 *   - installer review (75 credits)
 *
 * How the hard stop works:
 *   1. Try to INSERT a RewardGrant row with the (userId, rewardKey) pair.
 *   2. The DB has a UNIQUE constraint on (userId, rewardKey).
 *   3. If the row already exists → INSERT fails → credits are NOT awarded.
 *   4. If the row is new → INSERT succeeds → awardCredits() runs in the same
 *      $transaction so the RewardGrant and CreditTransaction are atomic.
 *
 * A device can be disconnected and reconnected any number of times.
 * The rewardKey "device_connect:{device.id}" is keyed to the Device.id (the
 * GridGuide DB row id, not the externalId), so a reconnect via upsert reuses
 * the same Device row and the same rewardKey — the unique constraint fires
 * and the reward is skipped.
 *
 * @param {string} userId
 * @param {string} rewardKey   — unique per event, e.g. "device_connect:clm1abc"
 * @param {number} credits     — positive integer
 * @param {string} reason      — CreditTransaction.reason label
 * @param {object} [metadata]
 * @returns {{ granted: boolean, credits: number, alreadyGranted: boolean }}
 */
export async function awardOneTimeCredits(userId, rewardKey, credits, reason, metadata = {}) {
  if (credits <= 0) throw new Error("awardOneTimeCredits requires positive credits");

  const account = await ensureCreditAccount(userId);

  try {
    await prisma.$transaction([
      // Step 1 — claim the reward slot. Fails with unique constraint if already done.
      prisma.rewardGrant.create({
        data: { userId, rewardKey, credits, reason, metadata },
      }),
      // Step 2 — credit the wallet.
      prisma.creditAccount.update({
        where: { id: account.id },
        data: {
          balance:        { increment: credits },
          lifetimeEarned: { increment: credits },
        },
      }),
      // Step 3 — log the transaction.
      prisma.creditTransaction.create({
        data: { creditAccountId: account.id, amount: credits, reason, metadata: { rewardKey, ...metadata } },
      }),
    ]);

    return { granted: true, credits, alreadyGranted: false };

  } catch (e) {
    // Unique constraint violation = already granted. Any other error re-throws.
    if (e.code === "P2002" || (e.message && e.message.includes("Unique constraint"))) {
      return { granted: false, credits: 0, alreadyGranted: true };
    }
    throw e;
  }
}

/**
 * Award the one-time 250-credit device connection bonus.
 *
 * Call this after a Device row has been created or upserted. Pass the Device.id
 * (GridGuide DB primary key) — not the externalId. If the device was previously
 * connected, disconnected, and reconnected, the upsert reuses the same Device.id
 * and this function returns { granted: false, alreadyGranted: true } — no
 * double-pay.
 *
 * @param {string} userId
 * @param {string} deviceId  — Device.id (DB primary key)
 * @param {string} deviceName — for metadata/audit only
 */
export async function awardDeviceConnectCredits(userId, deviceId, deviceName = "") {
  const cfg = await getPlatformConfig();
  const credits = cfg.deviceConnectCredits ?? 250;
  const rewardKey = `device_connect:${deviceId}`;

  return awardOneTimeCredits(userId, rewardKey, credits, "device_connect", {
    deviceId,
    deviceName,
  });
}
