/**
 * POST /api/enterprise/billing/create-subscription — the actual first call
 * to Stripe subscription creation for an EnterpriseOrg. Nothing previously
 * called this - orgs provisioned via the request-access approval flow have
 * a Stripe customer (created lazily by the billing portal) but no
 * subscription. Creates a two-item subscription: the org's base plan price,
 * plus a quantity-based sponsored-seat item starting at 0.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseOwner } from "@/lib/enterprise-permissions.js";
import { stripe, PRICES, createEnterpriseSubscription } from "@/lib/stripe.js";
import { logAudit } from "@/lib/audit.js";

const BASE_PRICE_BY_PLAN = {
  ENTERPRISE_BASIC: "ENTERPRISE_BASIC",
  ENTERPRISE_PRO:   "ENTERPRISE_PRO",
  ENTERPRISE_SCALE: "ENTERPRISE_SCALE",
};

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseOwner(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;
  if (org.sponsorshipStripeSubscriptionId) return err("A subscription already exists for this organization.", 409);

  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: org.contactEmail, name: org.name, metadata: { enterpriseOrgId: org.id } });
    customerId = customer.id;
  }

  const priceKey = BASE_PRICE_BY_PLAN[org.plan] || "ENTERPRISE_BASIC";
  const basePriceId = PRICES[org.billingCycle === "ANNUAL" ? `${priceKey}_ANNUAL` : priceKey];

  const subscription = await createEnterpriseSubscription({ customerId, basePriceId });
  const seatItem = subscription.items.data.find((i) => i.price.id === PRICES.ENTERPRISE_SPONSORED_SEAT);

  const updated = await prisma.enterpriseOrg.update({
    where: { id: org.id },
    data: {
      stripeCustomerId: customerId,
      sponsorshipStripeSubscriptionId: subscription.id,
      sponsorshipStripeItemId: seatItem?.id || null,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "ENTERPRISE_SUBSCRIPTION_CREATED",
    targetType: "EnterpriseOrg", targetId: org.id, orgId: org.id,
    category: "BILLING", metadata: { plan: org.plan, billingCycle: org.billingCycle, subscriptionId: subscription.id },
  });

  return ok({
    org: updated,
    clientSecret: subscription.latest_invoice?.payment_intent?.client_secret || null,
    message: "Subscription created.",
  }, 201);
}
