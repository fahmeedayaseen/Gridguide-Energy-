/**
 * GridGuide — Cash wallet withdrawals.
 *
 * Replaces the old flow, which (a) pushed full routing and account numbers
 * in plaintext onto a Redis list that nothing ever consumed, and (b) left
 * every withdrawal in PROCESSING forever with the money already gone from
 * the wallet.
 *
 * Execution model — controlled, admin-executed payouts:
 *
 *   User requests       -> PENDING_REVIEW  (balance debited, moved to pendingWithdrawals,
 *                                           bank details encrypted at rest)
 *   Admin approves      -> PROCESSING
 *   Admin reveals details (audit-logged) and sends the ACH / wire / check
 *   Admin marks sent    -> COMPLETED       (pendingWithdrawals cleared, details wiped)
 *   Admin rejects/fails -> CANCELLED / FAILED (money returned to balance, details wiped)
 *   User cancels        -> CANCELLED       (only while PENDING_REVIEW)
 *
 * Every transition is a status-guarded update inside a DB transaction, so a
 * withdrawal can't be completed twice or refunded twice.
 *
 * Instant Stripe payouts and PayPal are not offered: there is no integration
 * that can actually execute them yet (homeowners have no Stripe Connect
 * account, and there is no PayPal Payouts integration).
 */
import { prisma } from "./db.js";
import { encryptJson, decryptJson } from "./field-encryption.js";
import { debitWalletBalance, ensureWallet, roundCents, WalletError } from "./wallet.js";
import { logAudit } from "./audit.js";

export const WITHDRAWAL_METHODS = {
  ach: {
    label:          "Bank Account (ACH)",
    minAmount:      10,
    fee:            0,
    processingTime: "3–5 business days",
    needsBank:      true,
  },
  wire: {
    label:          "Wire Transfer",
    minAmount:      100,
    fee:            15.0,
    processingTime: "1–2 business days",
    needsBank:      true,
  },
  check: {
    label:          "Paper Check",
    minAmount:      25,
    fee:            3.0,
    processingTime: "7–10 business days",
    needsBank:      false,
  },
};

const UNAVAILABLE_METHODS = {
  stripe: "Instant payouts aren't available yet. Please choose bank transfer (ACH), wire, or check.",
  paypal: "PayPal payouts aren't available yet. Please choose bank transfer (ACH), wire, or check.",
};

const MAX_WITHDRAWAL = 25000;

/** Fields safe to return to the owning user or show in admin lists. Never includes encryptedDestination. */
export const WITHDRAWAL_PUBLIC_SELECT = {
  id: true,
  method: true,
  grossAmount: true,
  fee: true,
  netAmount: true,
  status: true,
  processingTime: true,
  destination: true,
  routingLast4: true,
  accountLast4: true,
  externalReference: true,
  failureReason: true,
  approvedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
};

function validateBankDetails(bankDetails) {
  const routing = String(bankDetails?.routing || "").replace(/\s/g, "");
  const account = String(bankDetails?.account || "").replace(/\s/g, "");
  const name    = String(bankDetails?.name || "").trim();

  if (!/^\d{9}$/.test(routing) || !isValidAbaChecksum(routing)) {
    throw new WalletError("Enter a valid 9-digit routing number.");
  }
  if (!/^\d{4,17}$/.test(account)) {
    throw new WalletError("Enter a valid bank account number (4–17 digits).");
  }
  if (name.length < 2 || name.length > 120) {
    throw new WalletError("Enter the account holder's name.");
  }
  return { routing, account, name };
}

/** ABA routing number checksum (3-7-1 weighting). Catches most typos before money is sent. */
export function isValidAbaChecksum(routing) {
  if (!/^\d{9}$/.test(routing)) return false;
  const d = routing.split("").map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/**
 * Create a withdrawal request. Debits the wallet atomically (no overdraw
 * under concurrency) and stores bank details encrypted.
 */
export async function createWithdrawal(userId, { method, amount, bankDetails }) {
  if (UNAVAILABLE_METHODS[method]) throw new WalletError(UNAVAILABLE_METHODS[method]);
  const config = WITHDRAWAL_METHODS[method];
  if (!config) throw new WalletError(`Unknown withdrawal method: ${method}`);

  amount = roundCents(amount);
  if (!(amount > 0) || amount > MAX_WITHDRAWAL) {
    throw new WalletError(`Withdrawal amount must be between $${config.minAmount.toFixed(2)} and $${MAX_WITHDRAWAL.toLocaleString()}.`);
  }
  if (amount < config.minAmount) {
    throw new WalletError(`Minimum withdrawal for ${config.label} is $${config.minAmount.toFixed(2)}.`);
  }

  const fee = config.fee;
  const netAmount = roundCents(amount - fee);
  if (netAmount <= 0) throw new WalletError("Amount must be greater than the withdrawal fee.");

  let bank = null;
  let encryptedDestination = null;
  if (config.needsBank) {
    bank = validateBankDetails(bankDetails);
    // Encrypt before touching the database — a missing key in production throws here
    // and nothing is debited.
    encryptedDestination = encryptJson(bank);
  }

  const destination = method === "check"
    ? "Paper check to mailing address on file"
    : `${method === "wire" ? "Wire" : "ACH"} to account ****${bank.account.slice(-4)} (${bank.name})`;

  const wallet = await ensureWallet(userId);

  return prisma.$transaction(async (tx) => {
    const debited = await debitWalletBalance(tx, wallet.id, amount);
    if (!debited) {
      const fresh = await tx.wallet.findUnique({ where: { id: wallet.id } });
      throw new WalletError(`Insufficient balance. You have $${(fresh?.balance ?? 0).toFixed(2)} available.`);
    }
    await tx.wallet.update({
      where: { id: wallet.id },
      data:  { pendingWithdrawals: { increment: amount } },
    });

    const withdrawal = await tx.withdrawal.create({
      data: {
        userId,
        walletId:       wallet.id,
        method,
        grossAmount:    amount,
        fee,
        netAmount,
        status:         "PENDING_REVIEW",
        processingTime: config.processingTime,
        destination,
        routingLast4:   bank ? bank.routing.slice(-4) : null,
        accountLast4:   bank ? bank.account.slice(-4) : null,
        encryptedDestination,
      },
      select: WITHDRAWAL_PUBLIC_SELECT,
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type:     "WITHDRAWAL",
        amount:   -amount,
        status:   "PENDING",
        metadata: { withdrawalId: withdrawal.id, method },
      },
    });

    return withdrawal;
  });
}

// ── State transitions ─────────────────────────────────────────────────────────

/** Drop the ciphertext before anything leaves this module. */
function publicView(w) {
  if (!w) return w;
  const { encryptedDestination, ...rest } = w;
  return { ...rest, hasPayoutDetails: !!encryptedDestination };
}

async function transition(tx, id, fromStatuses, data) {
  const res = await tx.withdrawal.updateMany({
    where: { id, status: { in: fromStatuses } },
    data,
  });
  if (res.count !== 1) {
    const current = await tx.withdrawal.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new WalletError("Withdrawal not found.", 404);
    throw new WalletError(`Withdrawal is ${current.status}; that action isn't allowed.`, 409);
  }
  return tx.withdrawal.findUnique({ where: { id } });
}

async function setLedgerStatus(tx, withdrawalId, status, failureReason = null) {
  // Prisma 5 can't filter on a JSON path portably across providers, so match in SQL.
  await tx.$executeRaw`
    UPDATE "WalletTransaction"
       SET "status" = ${status}, "failureReason" = ${failureReason}, "updatedAt" = NOW()
     WHERE "type" = 'WITHDRAWAL'
       AND "status" = 'PENDING'
       AND "metadata"->>'withdrawalId' = ${withdrawalId}`;
}

async function notify(userId, title, message, data) {
  await prisma.notification.create({
    data: { userId, type: "WALLET_WITHDRAWAL", title, message, data },
  }).catch(() => {});
}

/** Return a withdrawal's money to the wallet (status already moved to a terminal failure state). */
async function returnFunds(tx, withdrawal, reason) {
  await tx.wallet.update({
    where: { id: withdrawal.walletId },
    data: {
      balance:            { increment: withdrawal.grossAmount },
      pendingWithdrawals: { decrement: withdrawal.grossAmount },
    },
  });
  await setLedgerStatus(tx, withdrawal.id, "REVERSED", reason);
}

export async function approveWithdrawal(id, admin) {
  const w = await prisma.$transaction((tx) =>
    transition(tx, id, ["PENDING_REVIEW"], {
      status: "PROCESSING",
      approvedAt: new Date(),
      reviewedById: admin.id,
    })
  );
  await logAudit({
    actorUserId: admin.id, actorRole: admin.role, action: "WITHDRAWAL_APPROVED",
    targetType: "Withdrawal", targetId: id, category: "BILLING",
    metadata: { grossAmount: w.grossAmount, method: w.method },
  });
  return publicView(w);
}

/**
 * Decrypt payout details so an admin can send the transfer. Only allowed
 * while PROCESSING, and every reveal is written to the audit log.
 */
export async function revealWithdrawalDestination(id, admin) {
  const w = await prisma.withdrawal.findUnique({ where: { id } });
  if (!w) throw new WalletError("Withdrawal not found.", 404);
  if (w.status !== "PROCESSING") {
    throw new WalletError("Approve the withdrawal before viewing payout details.", 409);
  }
  if (!w.encryptedDestination) {
    throw new WalletError(w.method === "check"
      ? "Checks are mailed to the user's address on file."
      : "No payout details stored for this withdrawal.", 404);
  }
  const details = decryptJson(w.encryptedDestination);
  await logAudit({
    actorUserId: admin.id, actorRole: admin.role, action: "WITHDRAWAL_DESTINATION_REVEALED",
    targetType: "Withdrawal", targetId: id, category: "BILLING",
    metadata: { method: w.method, accountLast4: w.accountLast4 },
  });
  return { method: w.method, netAmount: w.netAmount, ...details };
}

export async function completeWithdrawal(id, admin, { externalReference } = {}) {
  const ref = String(externalReference || "").trim();
  if (!ref) throw new WalletError("Enter the bank trace number, wire reference, or check number.");

  const w = await prisma.$transaction(async (tx) => {
    const updated = await transition(tx, id, ["PROCESSING"], {
      status: "COMPLETED",
      completedAt: new Date(),
      externalReference: ref.slice(0, 120),
      encryptedDestination: null, // no longer needed — don't keep bank numbers around
    });
    await tx.wallet.update({
      where: { id: updated.walletId },
      data:  { pendingWithdrawals: { decrement: updated.grossAmount } },
    });
    await setLedgerStatus(tx, id, "COMPLETED");
    return updated;
  });

  await logAudit({
    actorUserId: admin.id, actorRole: admin.role, action: "WITHDRAWAL_COMPLETED",
    targetType: "Withdrawal", targetId: id, category: "BILLING",
    metadata: { grossAmount: w.grossAmount, netAmount: w.netAmount, externalReference: w.externalReference },
  });
  await notify(w.userId, "Withdrawal sent",
    `Your $${w.netAmount.toFixed(2)} withdrawal has been sent. ${w.processingTime ? `Expected arrival: ${w.processingTime}.` : ""}`.trim(),
    { withdrawalId: w.id });
  return publicView(w);
}

/** Admin rejects (before sending) or marks a sent payment as failed/returned. Money goes back to the wallet. */
export async function failWithdrawal(id, admin, { reason } = {}) {
  const why = String(reason || "").trim();
  if (!why) throw new WalletError("Enter a reason.");

  const w = await prisma.$transaction(async (tx) => {
    const current = await tx.withdrawal.findUnique({ where: { id }, select: { status: true } });
    const nextStatus = current?.status === "PENDING_REVIEW" ? "CANCELLED" : "FAILED";
    const updated = await transition(tx, id, ["PENDING_REVIEW", "PROCESSING"], {
      status: nextStatus,
      failureReason: why.slice(0, 500),
      reviewedById: admin.id,
      encryptedDestination: null,
    });
    await returnFunds(tx, updated, why);
    return updated;
  });

  await logAudit({
    actorUserId: admin.id, actorRole: admin.role, action: `WITHDRAWAL_${w.status}`,
    targetType: "Withdrawal", targetId: id, category: "BILLING",
    metadata: { grossAmount: w.grossAmount, reason: why },
  });
  await notify(w.userId, "Withdrawal not completed",
    `Your $${w.grossAmount.toFixed(2)} withdrawal couldn't be completed and the money is back in your wallet. Reason: ${why}`,
    { withdrawalId: w.id });
  return publicView(w);
}

/** The owner can cancel only before an admin has approved it. */
export async function cancelWithdrawalByUser(id, userId) {
  const owned = await prisma.withdrawal.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) throw new WalletError("Withdrawal not found.", 404);

  return prisma.$transaction(async (tx) => {
    const updated = await transition(tx, id, ["PENDING_REVIEW"], {
      status: "CANCELLED",
      failureReason: "Cancelled by user",
      encryptedDestination: null,
    });
    await returnFunds(tx, updated, "Cancelled by user");
    return tx.withdrawal.findUnique({ where: { id }, select: WITHDRAWAL_PUBLIC_SELECT });
  });
}
