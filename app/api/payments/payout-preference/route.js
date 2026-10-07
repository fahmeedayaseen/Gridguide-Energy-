/**
 * GET  /api/payments/payout-preference   — get current payout method
 * POST /api/payments/payout-preference   — set payout method
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const schema = z.object({
  method:          z.enum(["stripe", "ach", "paypal"]),
  stripeCardId:    z.string().optional(),
  bankRoutingLast4: z.string().length(4).optional(),
  bankAccountLast4: z.string().min(4).max(4).optional(),
  bankAccountName:  z.string().optional(),
  paypalEmail:     z.string().email().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const pref = await prisma.payoutPreference.findUnique({ where: { userId: auth.user.id } });
  return ok({ preference: pref || { method: "stripe" } });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  if (data.method === "ach" && (!data.bankAccountLast4 || !data.bankAccountName)) {
    return err("ACH payout requires bank account details.", 400);
  }
  if (data.method === "paypal" && !data.paypalEmail) {
    return err("PayPal payout requires a PayPal email address.", 400);
  }

  const pref = await prisma.payoutPreference.upsert({
    where:  { userId: auth.user.id },
    create: { userId: auth.user.id, ...data },
    update: data,
  });

  return ok({ preference: pref, message: "Payout method updated." });
}
