/**
 * POST /api/installers/billing-portal — Stripe billing portal session so the
 * installer can update their card/bank, view invoices, or cancel. Replaces
 * the non-functional "Add Card" / "Link Bank" buttons.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { stripe, createBillingPortalSession } from "@/lib/stripe.js";

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id }, select: { id: true, companyName: true } });
  if (!installer) return err("Installer not found", 404);

  const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { id: true, email: true, stripeCustomerId: true } });
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, name: installer.companyName, metadata: { userId: user.id, installerId: installer.id } });
    customerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const origin  = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const session = await createBillingPortalSession({ customerId, returnUrl: `${origin}/portals/installer?tab=payments` });
  return ok({ url: session.url });
}
