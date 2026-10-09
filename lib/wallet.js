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
import { stripe } from "./stripe.js";
import { alertCritical, logger } from "./sentry.js";

/**
 * Error with an HTTP status, safe to show to the user. Anything that is NOT
 * a WalletError is an internal failure and routes should return a generic 500.
 */
export class WalletError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.name = "WalletError";
    this.status = status;
    Object.assign(this, extra);
  }
}

// Float columns accumulate binary rounding noise; compare with a sub-cent tolerance.
const EPSILON = 0.000001;

export function roundCents(amount) {
  return Math.round(Number(amount) * 100) / 100;
}

/**
 * Ensure a user has a Wallet row, creating one if needed.
 */
export async function ensureWallet(userId, db = prisma) {
  const existing = await db.wallet.findUnique({ where: { userId } });
  if (existing) return existing;
  // upsert so two concurrent first-time callers don't collide on the unique userId.
  return db.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
}

/**
 * Atomically take `amount` out of a wallet's spendable balance.
 *
 * The balance check and the decrement are a single conditional UPDATE, so
 * two concurrent requests can never both pass a "do they have enough?"
 * check and drive the balance negative (the old read-then-update pattern
 * could). Returns false when the balance is insufficient.
 *
 * Must be called with a transaction client (`tx`) when paired with other writes.
 */
export async function debitWalletBalance(tx, walletId, amount) {
  const updated = await tx.$executeRaw`
    UPDATE "Wallet"
       SET "balance" = "balance" - ${amount}::double precision,
           "updatedAt" = NOW()
     WHERE "id" = ${walletId}
       AND "balance" >= ${amount}::double precision - ${EPSILON}::double precision`;
  return updated === 1;
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
  amount = roundCents(amount);
  if (!(amount > 0)) throw new Error("depositToWallet requires a positive amount");

  const wallet = await ensureWallet(userId);

  const [updated] = await prisma.$transaction([
    prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance:        { increment: amount },
        lifetimeEarned: { increment: amount },
      },
    }),
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type:     "DEPOSIT",
        amount,
        status:   "COMPLETED",
        metadata: { source, ...metadata },
      },
    }),
  ]);

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
 *
 * `balance` is already net of pending withdrawals (a withdrawal moves money
 * from balance into pendingWithdrawals), so `available` IS the balance.
 * The previous code subtracted pendingWithdrawals a second time and showed
 * users less money than they actually had.
 */
export async function getWalletBalance(userId) {
  const wallet = await ensureWallet(userId);
  return {
    balance:            wallet.balance,
    pendingWithdrawals: wallet.pendingWithdrawals,
    lifetimeEarned:     wallet.lifetimeEarned,
    available:          Math.max(0, wallet.balance),
  };
}

// ── Apply wallet cash to the subscription (two-phase) ─────────────────────────

const RECONCILE_AFTER_MINUTES = 5;
// Stripe keeps idempotency keys for at least 24 hours. After that a retry is
// no longer guaranteed to be de-duplicated, so we stop retrying automatically.
const STRIPE_IDEMPOTENCY_WINDOW_HOURS = 23;

function stripeIdempotencyKey(walletTransactionId) {
  return `wallet-subscription-credit-${walletTransactionId}`;
}

/**
 * True when Stripe definitively rejected the request (nothing was created),
 * so refunding the wallet is safe. Network errors, timeouts, 5xx and rate
 * limits are ambiguous — the credit may have been created — so those stay
 * PENDING and are resolved by reconciliation instead of being refunded.
 */
function isDefinitiveStripeRejection(e) {
  const status = e?.statusCode;
  if (!status) return false;               // network/connection error: ambiguous
  if (status === 429 || status >= 500) return false;
  if (status === 409) return false;        // idempotency conflict: a request is in flight
  return status >= 400;
}

/**
 * Apply cash wallet balance toward the subscription (homeowner's choice,
 * separate from a bank/debit withdrawal). Unlike Credits redemption, this is
 * NOT capped — it's the homeowner's own real money.
 *
 * Two-phase so a wallet debit can never "succeed" without the credit landing
 * in Stripe (previously the wallet was debited first and a Stripe failure,
 * or a user with no Stripe customer, silently swallowed the money):
 *
 *   1. One DB transaction: conditional debit + WalletTransaction(PENDING).
 *   2. Stripe customer-balance credit, with an idempotency key derived from
 *      the transaction id (safe to retry).
 *   3. Success -> COMPLETED. Definitive rejection -> wallet refunded, REVERSED.
 *      Ambiguous failure -> left PENDING; reconcilePendingWalletTransactions()
 *      retries with the same key and finishes it either way.
 *
 * The credit goes on the Stripe customer balance, which Stripe applies
 * automatically to the customer's next invoice(s).
 *
 * @param {string} userId
 * @param {number} amount - dollar amount to apply
 * @param {{ idempotencyKey?: string }} [opts] - client-supplied key so a double-submit applies once
 */
export async function applyWalletToSubscription(userId, amount, { idempotencyKey } = {}) {
  amount = roundCents(amount);
  if (!(amount >= 0.5)) throw new WalletError("Minimum amount to apply is $0.50.");

  if (idempotencyKey) {
    const prior = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (prior) return describeSubscriptionCredit(prior);
  }

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    throw new WalletError("You don't have a billing account yet. Start a subscription before applying wallet cash to it.", 409);
  }

  const wallet = await ensureWallet(userId);

  let txn;
  try {
    txn = await prisma.$transaction(async (tx) => {
      const debited = await debitWalletBalance(tx, wallet.id, amount);
      if (!debited) {
        const fresh = await tx.wallet.findUnique({ where: { id: wallet.id } });
        throw new WalletError(
          `Insufficient wallet balance. Have $${(fresh?.balance ?? 0).toFixed(2)}, requested $${amount.toFixed(2)}.`
        );
      }
      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type:     "SUBSCRIPTION_CREDIT",
          amount:   -amount,
          status:   "PENDING",
          idempotencyKey: idempotencyKey || null,
          metadata: { stripeCustomerId: user.stripeCustomerId },
        },
      });
    });
  } catch (e) {
    // Lost a race on the same client idempotency key: return the winner's result.
    if (e?.code === "P2002" && idempotencyKey) {
      const prior = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
      if (prior) return describeSubscriptionCredit(prior);
    }
    throw e;
  }

  const settled = await settleSubscriptionCredit(txn);
  return describeSubscriptionCredit(settled);
}

/**
 * Phase 2 for one PENDING SUBSCRIPTION_CREDIT row. Safe to call repeatedly.
 * Returns the row in its resulting state.
 */
async function settleSubscriptionCredit(txn) {
  const amount = Math.abs(txn.amount);
  const customerId = txn.metadata?.stripeCustomerId;

  try {
    const balanceTxn = await stripe.customers.createBalanceTransaction(
      customerId,
      {
        amount:      -Math.round(amount * 100), // negative = credit toward future invoices
        currency:    "usd",
        description: "GridGuide wallet balance applied to subscription",
        metadata:    { walletTransactionId: txn.id, userId: txn.userId },
      },
      { idempotencyKey: stripeIdempotencyKey(txn.id) }
    );

    await prisma.walletTransaction.updateMany({
      where: { id: txn.id, status: "PENDING" },
      data:  { status: "COMPLETED", externalRef: balanceTxn.id },
    });
  } catch (e) {
    if (isDefinitiveStripeRejection(e)) {
      await reverseWalletTransaction(txn, `Stripe rejected the credit: ${e.message}`);
    } else {
      logger.warn("[Wallet] Subscription credit outcome unknown; left PENDING for reconciliation", {
        walletTransactionId: txn.id,
        error: e?.message,
      });
    }
  }

  return prisma.walletTransaction.findUnique({ where: { id: txn.id } });
}

/**
 * Refund a PENDING wallet debit. The status guard makes this idempotent:
 * only the caller that flips PENDING -> REVERSED returns the money.
 */
async function reverseWalletTransaction(txn, reason) {
  await prisma.$transaction(async (tx) => {
    const flipped = await tx.walletTransaction.updateMany({
      where: { id: txn.id, status: "PENDING" },
      data:  { status: "REVERSED", failureReason: String(reason).slice(0, 500) },
    });
    if (flipped.count !== 1) return; // already resolved elsewhere
    await tx.wallet.update({
      where: { id: txn.walletId },
      data:  { balance: { increment: Math.abs(txn.amount) } },
    });
  });
}

function describeSubscriptionCredit(txn) {
  const amount = Math.abs(txn.amount);
  if (txn.status === "COMPLETED") {
    return { status: "COMPLETED", amountApplied: amount, walletTransactionId: txn.id };
  }
  if (txn.status === "REVERSED") {
    throw new WalletError(
      "We couldn't apply your wallet balance to your subscription. Your wallet was not charged.",
      502,
      { walletTransactionId: txn.id }
    );
  }
  return { status: "PENDING", amountApplied: amount, walletTransactionId: txn.id };
}

/**
 * Resolve SUBSCRIPTION_CREDIT rows stuck in PENDING (process crash, Stripe
 * timeout). Retries the Stripe call with the original idempotency key, so a
 * credit that actually landed is recognised rather than duplicated. Rows past
 * Stripe's idempotency window are escalated for manual review, never retried.
 * Run from cron (POST /api/cron?job=wallet-reconcile).
 */
export async function reconcilePendingWalletTransactions() {
  const now = Date.now();
  const stale = await prisma.walletTransaction.findMany({
    where: {
      type:      "SUBSCRIPTION_CREDIT",
      status:    "PENDING",
      createdAt: { lt: new Date(now - RECONCILE_AFTER_MINUTES * 60 * 1000) },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const result = { checked: stale.length, completed: 0, reversed: 0, stillPending: 0, escalated: 0 };

  for (const txn of stale) {
    const ageHours = (now - new Date(txn.createdAt).getTime()) / 3_600_000;
    if (ageHours > STRIPE_IDEMPOTENCY_WINDOW_HOURS) {
      result.escalated++;
      if (!txn.metadata?.escalated) {
        await prisma.walletTransaction.update({
          where: { id: txn.id },
          data:  { metadata: { ...(txn.metadata || {}), escalated: true } },
        });
        await alertCritical("Wallet subscription credit unresolved past Stripe idempotency window — manual review needed", {
          walletTransactionId: txn.id,
          userId: txn.userId,
          amount: txn.amount,
        });
      }
      continue;
    }

    const settled = await settleSubscriptionCredit(txn);
    if (settled?.status === "COMPLETED") result.completed++;
    else if (settled?.status === "REVERSED") result.reversed++;
    else result.stillPending++;
  }

  return result;
}

// ── Grid Fund donations ───────────────────────────────────────────────────────

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
  amount = roundCents(amount);
  if (!(amount > 0)) throw new WalletError("Donation amount must be positive.");

  const cfg = await getPlatformConfig();
  if (amount < cfg.gridFundDonationMinDollars) {
    throw new WalletError(`Minimum Grid Fund donation is $${cfg.gridFundDonationMinDollars.toFixed(2)}.`);
  }

  const wallet = await ensureWallet(userId);

  // Bonus credits = 10% of the donated dollar value, converted at the
  // platform's creditsPerDollar rate (e.g. $10 donated × 10% = $1 worth
  // of credits = 1,000 credits at the default 1,000 credits/$1 rate).
  const bonusDollarValue = amount * cfg.gridFundDonationBonusPct;
  const bonusCredits = Math.round(bonusDollarValue * cfg.creditsPerDollar);

  // Conditional debit + donation record + ledger row in one transaction, so
  // concurrent donations can't overdraw the wallet.
  const { updatedWallet, donation } = await prisma.$transaction(async (tx) => {
    const debited = await debitWalletBalance(tx, wallet.id, amount);
    if (!debited) {
      const fresh = await tx.wallet.findUnique({ where: { id: wallet.id } });
      throw new WalletError(
        `Insufficient wallet balance. Have $${(fresh?.balance ?? 0).toFixed(2)}, requested $${amount.toFixed(2)}.`
      );
    }
    const donation = await tx.gridFundDonation.create({
      data: { userId, amount, source: "cash_wallet", creditBonusAwarded: bonusCredits },
    });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type:     "GRID_FUND_DONATION",
        amount:   -amount,
        status:   "COMPLETED",
        metadata: { donationId: donation.id },
      },
    });
    const updatedWallet = await tx.wallet.findUnique({ where: { id: wallet.id } });
    return { updatedWallet, donation };
  });

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
