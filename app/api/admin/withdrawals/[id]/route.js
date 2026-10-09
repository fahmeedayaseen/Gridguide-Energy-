/**
 * POST /api/admin/withdrawals/:id
 * Body: { action: "approve" }
 *       { action: "reveal" }                              — decrypted payout details (PROCESSING only, audit-logged)
 *       { action: "complete", externalReference: string } — payment sent
 *       { action: "fail", reason: string }                — reject or mark failed; money returns to the wallet
 */
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { WalletError } from "@/lib/wallet.js";
import {
  approveWithdrawal, revealWithdrawalDestination, completeWithdrawal, failWithdrawal,
} from "@/lib/withdrawals.js";
import { logger } from "@/lib/sentry.js";
import { z } from "zod";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reveal") }),
  z.object({ action: z.literal("complete"), externalReference: z.string().min(1).max(120) }),
  z.object({ action: z.literal("fail"), reason: z.string().min(1).max(500) }),
]);

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const admin = auth.user;
  try {
    switch (data.action) {
      case "approve":
        return ok({ withdrawal: await approveWithdrawal(params.id, admin) });
      case "reveal": {
        const res = ok({ payoutDetails: await revealWithdrawalDestination(params.id, admin) });
        res.headers.set("Cache-Control", "no-store");
        return res;
      }
      case "complete":
        return ok({ withdrawal: await completeWithdrawal(params.id, admin, data) });
      case "fail":
        return ok({ withdrawal: await failWithdrawal(params.id, admin, data) });
    }
  } catch (e) {
    if (e instanceof WalletError) return err(e.message, e.status);
    logger.error("[Admin withdrawals] Action failed", { withdrawalId: params.id, action: data.action, error: e?.message });
    return err("Action failed. Please try again.", 500);
  }
}
