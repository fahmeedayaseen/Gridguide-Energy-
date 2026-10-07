/**
 * POST /api/enterprise/billing/change-cycle — swap between monthly and
 * annual billing for the org's base subscription item, using Stripe's
 * proration on the switch. 15% annual discount is baked into the annual
 * Price IDs directly (set at Stripe price-creation time), not calculated
 * here.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseOwner } from "@/lib/enterprise-permissions.js";
import { stripe, PRICES, changeEnterpriseSubscriptionPrice } from "@/lib/stripe.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const cycleSchema = z.object({ cycle: z.enum(["MONTHLY", "ANNUAL"]) });

const BASE_PRICE_BY_PLAN = { ENTERPRISE_BASIC: "ENTERPRISE_BASIC", ENTERPRISE_PRO: "ENTERPRISE_PRO", ENTERPRISE_SCALE: "ENTERPRISE_SCALE" };

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseOwner(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;
  if (!org.sponsorshipStripeSubscriptionId) return err("Set up billing before changing your billing cycle.", 400);

  const { data, error } = await parseBody(request, cycleSchema);
  if (error) return err("Validation failed", 400, error);

  if (data.cycle === org.billingCycle) return err(`Already on ${data.cycle.toLowerCase()} billing.`, 409);

  const subscription = await stripe.subscriptions.retrieve(org.sponsorshipStripeSubscriptionId);
  const priceKey = BASE_PRICE_BY_PLAN[org.plan] || "ENTERPRISE_BASIC";
  const newPriceId = PRICES[data.cycle === "ANNUAL" ? `${priceKey}_ANNUAL` : priceKey];
  const baseItem = subscription.items.data.find((i) => i.price.id !== PRICES.ENTERPRISE_SPONSORED_SEAT);
  if (!baseItem) return err("Could not find your base subscription item.", 500);

  await changeEnterpriseSubscriptionPrice({ subscriptionId: subscription.id, basePriceId: newPriceId, baseItemId: baseItem.id });

  const updated = await prisma.enterpriseOrg.update({ where: { id: org.id }, data: { billingCycle: data.cycle } });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "BILLING_CYCLE_CHANGED",
    targetType: "EnterpriseOrg", targetId: org.id, orgId: org.id,
    category: "BILLING", metadata: { newCycle: data.cycle },
  });

  return ok({ org: updated, message: `Switched to ${data.cycle.toLowerCase()} billing.` });
}
