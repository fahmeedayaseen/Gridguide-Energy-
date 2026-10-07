/**
 * POST /api/payments/withdraw
 *
 * Withdraw user wallet balance (VPP earnings, rewards cash) via:
 *   ach     — Bank Account ACH transfer (1–3 days, free, min $10)
 *   paypal  — PayPal / Venmo instant (free, min $5)
 *   check   — Paper check (7–10 days, $3 fee, min $25)
 *   wire    — Wire transfer (same day, $15 fee, min $100)
 *
 * Body: { method, amount, bankDetails? }
 *
 * GET /api/payments/withdraw — withdrawal history
 */

import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/sentry.js";
import { z } from "zod";

const METHODS = {
  stripe: {
    label:          "Stripe Instant Payout",
    minAmount:      1,
    fee:            0,         // 1.5% deducted dynamically
    feePercent:     0.015,
    processingTime: "Instant (24/7)",
  },
  ach: {
    label:       "Bank Account (ACH)",
    minAmount:   10,
    fee:         0,
    processingTime: "1–3 business days",
  },
  paypal: {
    label:       "PayPal / Venmo",
    minAmount:   5,
    fee:         0,
    processingTime: "Instant",
  },
  check: {
    label:       "Paper Check",
    minAmount:   25,
    fee:         3.00,
    processingTime: "7–10 business days",
  },
  wire: {
    label:       "Wire Transfer",
    minAmount:   100,
    fee:         15.00,
    processingTime: "Same business day",
  },
};

const withdrawSchema = z.object({
  method: z.enum(["stripe", "ach", "paypal", "check", "wire"]),
  amount: z.number().positive(),
  bankDetails: z.object({
    // ACH
    routing:  z.string().optional(),
    account:  z.string().optional(),
    name:     z.string().optional(),
    // PayPal
    paypalEmail: z.string().email().optional(),
    // Check — mailed to address on file
    // Wire — uses banking details above
  }).optional(),
});

// ── POST — initiate withdrawal ────────────────────────────────────────────────
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, withdrawSchema);
  if (error) return err("Validation failed", 400, error);

  const { method, amount, bankDetails } = data;
  const methodConfig = METHODS[method];
  if (!methodConfig) return err(`Unknown withdrawal method: ${method}`, 400);

  // Validate minimum
  if (amount < methodConfig.minAmount) {
    return err(`Minimum withdrawal for ${methodConfig.label} is $${methodConfig.minAmount.toFixed(2)}.`, 400);
  }

  // Validate bank details for ACH
  if (method === "ach") {
    if (!bankDetails?.routing || bankDetails.routing.length !== 9 || !/^\d{9}$/.test(bankDetails.routing)) {
      return err("ACH requires a valid 9-digit routing number.", 400);
    }
    if (!bankDetails?.account || bankDetails.account.length < 4) {
      return err("ACH requires a valid bank account number.", 400);
    }
    if (!bankDetails?.name) {
      return err("ACH requires the account holder name.", 400);
    }
  }

  // Validate PayPal
  if (method === "paypal" && !bankDetails?.paypalEmail && !bankDetails?.name) {
    return err("PayPal withdrawal requires a PayPal email address.", 400);
  }

  // Idempotency lock
  const lockKey = `withdraw-lock:${auth.user.id}`;
  const locked  = await redis.set(lockKey, "1", { NX: true, EX: 60 });
  if (!locked) return err("A withdrawal is already in progress. Please wait.", 429);

  try {
    // Fetch wallet balance
    const wallet = await prisma.wallet.findUnique({ where: { userId: auth.user.id } });
    if (!wallet) return err("Wallet not found. Complete account setup first.", 404);

    const fee       = methodConfig.feePercent
      ? parseFloat((amount * methodConfig.feePercent).toFixed(2))
      : methodConfig.fee;
    const netAmount = Math.max(amount - fee, 0);

    if (amount > wallet.balance) {
      return err(`Insufficient balance. You have $${wallet.balance.toFixed(2)} available.`, 400);
    }

    // Create withdrawal + deduct from wallet atomically
    const [withdrawal] = await prisma.$transaction([
      prisma.withdrawal.create({
        data: {
          userId:          auth.user.id,
          walletId:        wallet.id,
          method,
          grossAmount:     amount,
          fee,
          netAmount,
          status:          "PROCESSING",
          processingTime:  methodConfig.processingTime,
          // Store masked bank details (never store full account numbers)
          destination: method === "stripe"
            ? "Stripe Instant Payout to primary card"
            : method === "ach"
            ? `ACH ****${(bankDetails?.account || "").slice(-4)} (${bankDetails?.name})`
            : method === "paypal"
            ? bankDetails?.paypalEmail || bankDetails?.name || "PayPal"
            : method === "check"
            ? "Paper check to address on file"
            : "Wire transfer",
          // Store encrypted routing/account for processing (in production: encrypt at rest)
          routingLast4: bankDetails?.routing?.slice(-4),
          accountLast4: bankDetails?.account?.slice(-4),
        },
      }),
      prisma.wallet.update({
        where: { id: wallet.id },
        data:  { balance: { decrement: amount }, pendingWithdrawals: { increment: amount } },
      }),
    ]);

    // Queue for async processing
    await redis.lPush("withdrawal-queue", JSON.stringify({
      withdrawalId: withdrawal.id,
      userId:       auth.user.id,
      method,
      netAmount,
      destination:  withdrawal.destination,
      bankDetails:  method === "ach" ? { routing: bankDetails?.routing, account: bankDetails?.account, name: bankDetails?.name } : null,
      paypalEmail:  method === "paypal" ? (bankDetails?.paypalEmail || bankDetails?.name) : null,
      createdAt:    new Date().toISOString(),
    }));

    logger.info(`Withdrawal initiated`, {
      userId: auth.user.id,
      method,
      amount,
      netAmount,
      withdrawalId: withdrawal.id,
    });

    return ok({
      withdrawalId:    withdrawal.id,
      method,
      methodLabel:     methodConfig.label,
      grossAmount:     amount,
      fee,
      netAmount,
      processingTime:  methodConfig.processingTime,
      destination:     withdrawal.destination,
      status:          "PROCESSING",
      message: `$${netAmount.toFixed(2)} withdrawal via ${methodConfig.label} is being processed. Expected arrival: ${methodConfig.processingTime}.`,
    }, 201);

  } finally {
    await redis.del(lockKey);
  }
}

// ── GET — withdrawal history + available methods ──────────────────────────────
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const [withdrawals, wallet] = await Promise.all([
    prisma.withdrawal.findMany({
      where:   { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take:    20,
    }),
    prisma.wallet.findUnique({ where: { userId: auth.user.id } }),
  ]);

  return ok({
    withdrawals,
    balance:    wallet?.balance || 0,
    pending:    wallet?.pendingWithdrawals || 0,
    methods:    Object.entries(METHODS).map(([id, m]) => ({ id, ...m })),
  });
}
