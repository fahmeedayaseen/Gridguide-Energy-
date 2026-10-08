/**
 * GET /api/installers/invoices — the installer's real Stripe invoices
 * (membership subscription charges). Returns an empty list when the
 * installer has no Stripe customer yet; never fabricated rows.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { stripe } from "@/lib/stripe.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id }, select: { id: true } });
  if (!installer) return err("Installer not found", 404);

  const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { stripeCustomerId: true } });
  if (!user?.stripeCustomerId) return ok({ invoices: [] });

  try {
    const list = await stripe.invoices.list({ customer: user.stripeCustomerId, limit: 24 });
    const invoices = list.data.map((inv) => ({
      id:          inv.id,
      number:      inv.number || inv.id,
      description: inv.lines?.data?.[0]?.description || "GridGuide membership",
      date:        new Date((inv.status_transitions?.finalized_at || inv.created) * 1000).toISOString(),
      amount:      (inv.amount_paid || inv.amount_due || 0) / 100,
      currency:    inv.currency,
      status:      inv.status, // draft | open | paid | uncollectible | void
      pdfUrl:      inv.invoice_pdf || null,
      hostedUrl:   inv.hosted_invoice_url || null,
    }));
    return ok({ invoices });
  } catch (e) {
    console.error("[installers/invoices] Stripe list failed:", e.message);
    return err("Could not load invoices from Stripe", 502);
  }
}
