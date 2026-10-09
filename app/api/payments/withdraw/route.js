/**
 * POST /api/payments/withdraw
 *
 * Request a cash wallet withdrawal (VPP earnings, marketplace proceeds):
 *   ach   — Bank Account ACH transfer (free, min $10)
 *   wire  — Wire transfer ($15 fee, min $100)
 *   check — Paper check to address on file ($3 fee, min $25)
 *
 * Body: { method, amount, bankDetails?: { routing, account, name } }
 *
 * The money leaves the spendable balance immediately and sits in
 * pendingWithdrawals until an admin sends the payment (see lib/withdrawals.js).
 * Bank details are encrypted at rest and never returned by any user-facing API.
 *
 * GET /api/payments/withdraw — withdrawal history + available methods
 */

import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { rateLimit } from "@/lib/redis.js";
import { logger } from "@/lib/sentry.js";
import { WalletError } from "@/lib/wallet.js";
import { createWithdrawal, WITHDRAWAL_METHODS, WITHDRAWAL_PUBLIC_SELECT } from "@/lib/withdrawals.js";
import { z } from "zod";

const withdrawSchema = z.object({
  method: z.enum(["stripe", "ach", "paypal", "check", "wire"]),
  amount: z.number().positive(),
  bankDetails: z.object({
    routing: z.string().max(20).optional(),
    account: z.string().max(30).optional(),
    name:    z.string().max(120).optional(),
    paypalEmail: z.string().email().optional(),
  }).optional(),
});

// ── POST — request withdrawal ─────────────────────────────────────────────────
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const limit = await rateLimit(`withdraw:${auth.user.id}`, 5, 3600);
  if (!limit.allowed) return err("Too many withdrawal requests. Please try again later.", 429);

  const { data, error } = await parseBody(request, withdrawSchema);
  if (error) return err("Validation failed", 400, error);

  try {
    const withdrawal = await createWithdrawal(auth.user.id, data);
    const methodConfig = WITHDRAWAL_METHODS[withdrawal.method];

    logger.info("Withdrawal requested", {
      userId: auth.user.id,
      method: withdrawal.method,
      amount: withdrawal.grossAmount,
      withdrawalId: withdrawal.id,
    });

    return ok({
      withdrawalId:   withdrawal.id,
      method:         withdrawal.method,
      methodLabel:    methodConfig.label,
      grossAmount:    withdrawal.grossAmount,
      fee:            withdrawal.fee,
      netAmount:      withdrawal.netAmount,
      processingTime: withdrawal.processingTime,
      destination:    withdrawal.destination,
      status:         withdrawal.status,
      message: `Your $${withdrawal.netAmount.toFixed(2)} withdrawal via ${methodConfig.label} has been received and is being reviewed. Expected arrival after approval: ${methodConfig.processingTime}.`,
    }, 201);
  } catch (e) {
    if (e instanceof WalletError) return err(e.message, e.status);
    logger.error("[Withdraw] Unexpected failure", { userId: auth.user.id, error: e?.message });
    return err("We couldn't submit your withdrawal. Nothing was taken from your wallet. Please try again.", 500);
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
      select:  WITHDRAWAL_PUBLIC_SELECT,
    }),
    prisma.wallet.findUnique({ where: { userId: auth.user.id } }),
  ]);

  return ok({
    withdrawals,
    balance: wallet?.balance || 0,
    pending: wallet?.pendingWithdrawals || 0,
    methods: Object.entries(WITHDRAWAL_METHODS).map(([id, m]) => ({
      id, label: m.label, minAmount: m.minAmount, fee: m.fee, processingTime: m.processingTime,
    })),
  });
}
