/**
 * POST /api/enterprise/billing-portal — creates a Stripe billing portal
 * session so the org owner can manage payment method, view invoices, and
 * change plan.
 *
 * Lazily creates a Stripe customer if the org doesn't have one yet —
 * nothing in the signup/registration flow currently creates one for
 * EnterpriseOrg, so this is the actual first real touchpoint with Stripe
 * for most orgs.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseOwner } from "@/lib/enterprise-permissions.js";
import { stripe, createBillingPortalSession } from "@/lib/stripe.js";

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseOwner(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: org.contactEmail,
      name: org.name,
      metadata: { enterpriseOrgId: org.id },
    });
    customerId = customer.id;
    await prisma.enterpriseOrg.update({ where: { id: org.id }, data: { stripeCustomerId: customerId } });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
  const session = await createBillingPortalSession({
    customerId,
    returnUrl: `${baseUrl}/portals/enterprise?tab=billing`,
  });

  return ok({ url: session.url });
}
