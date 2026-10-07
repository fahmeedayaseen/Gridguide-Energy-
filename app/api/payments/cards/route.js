/**
 * GET  /api/payments/cards        — list user's saved cards
 * POST /api/payments/cards        — add a card (Stripe tokenization)
 * DELETE /api/payments/cards?id=  — remove a card
 * PATCH /api/payments/cards?id=   — set as primary
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import Stripe from "stripe";
import { z } from "zod";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-04-10" });

const addCardSchema = z.object({
  stripePaymentMethodId: z.string().startsWith("pm_"), // Frontend passes Stripe PM id
  role: z.enum(["PRIMARY", "SECONDARY"]).optional().default("SECONDARY"),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const cards = await prisma.paymentCard.findMany({
    where:   { userId: auth.user.id, isActive: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select:  { id: true, brand: true, last4: true, expMonth: true, expYear: true, cardholderName: true, role: true, createdAt: true },
  });

  return ok({ cards });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, addCardSchema);
  if (error) return err("Validation failed", 400, error);

  // Max 2 cards per user
  const existing = await prisma.paymentCard.count({ where: { userId: auth.user.id, isActive: true } });
  if (existing >= 2) return err("You already have 2 cards on file. Remove one first.", 400);

  // Retrieve the Stripe PaymentMethod to get card details
  let pm;
  try {
    pm = await stripe.paymentMethods.retrieve(data.stripePaymentMethodId);
  } catch (e) {
    return err("Could not retrieve card from Stripe. Please try again.", 400);
  }

  if (pm.type !== "card") return err("Only card payment methods are supported.", 400);

  // If adding PRIMARY, demote existing primary to secondary
  if (data.role === "PRIMARY") {
    await prisma.paymentCard.updateMany({
      where: { userId: auth.user.id, role: "PRIMARY", isActive: true },
      data:  { role: "SECONDARY" },
    });
  }

  // Attach PM to Stripe customer (create customer if needed)
  let stripeCustomerId = (await prisma.user.findUnique({ where: { id: auth.user.id }, select: { stripeCustomerId: true } }))?.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({ email: auth.user.email });
    stripeCustomerId = customer.id;
    await prisma.user.update({ where: { id: auth.user.id }, data: { stripeCustomerId } });
  }
  await stripe.paymentMethods.attach(data.stripePaymentMethodId, { customer: stripeCustomerId });

  const card = await prisma.paymentCard.create({
    data: {
      userId:         auth.user.id,
      stripeCardId:   data.stripePaymentMethodId,
      brand:          pm.card.brand.toUpperCase(),
      last4:          pm.card.last4,
      expMonth:       pm.card.exp_month,
      expYear:        pm.card.exp_year,
      cardholderName: pm.billing_details?.name || "",
      role:           data.role,
    },
  });

  return ok({ card: { id: card.id, brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, cardholderName: card.cardholderName, role: card.role }, message: "Card saved." }, 201);
}

export async function DELETE(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("Card ID required.", 400);

  const card = await prisma.paymentCard.findFirst({ where: { id, userId: auth.user.id, isActive: true } });
  if (!card) return err("Card not found.", 404);

  // Soft delete
  await prisma.paymentCard.update({ where: { id }, data: { isActive: false } });

  // If primary was removed and secondary exists, promote it
  if (card.role === "PRIMARY") {
    const secondary = await prisma.paymentCard.findFirst({ where: { userId: auth.user.id, role: "SECONDARY", isActive: true } });
    if (secondary) await prisma.paymentCard.update({ where: { id: secondary.id }, data: { role: "PRIMARY" } });
  }

  // Detach from Stripe
  try { await stripe.paymentMethods.detach(card.stripeCardId); } catch {}

  return ok({ message: "Card removed." });
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("Card ID required.", 400);

  const card = await prisma.paymentCard.findFirst({ where: { id, userId: auth.user.id, isActive: true } });
  if (!card) return err("Card not found.", 404);

  // Swap roles
  await prisma.$transaction([
    prisma.paymentCard.updateMany({ where: { userId: auth.user.id, role: "PRIMARY", isActive: true }, data: { role: "SECONDARY" } }),
    prisma.paymentCard.update({ where: { id }, data: { role: "PRIMARY" } }),
  ]);

  return ok({ message: "Card set as primary." });
}
