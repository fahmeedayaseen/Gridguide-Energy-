/**
 * GET   /api/installers/membership       — current plan + upgrade options
 * POST  /api/installers/membership       — upgrade/downgrade plan via Stripe
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import Stripe from "stripe";
import { z } from "zod";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", { apiVersion: "2024-04-10" });

const PLANS = {
  FREE:       { price: 0,   shareRate: 0.15, vppShare: 0.00, trial: null, leadSuccessFee: 0.08,  // 8% on GridGuide-generated leads
    features: ["Company profile","Basic lead management","Add installations","Refer homeowners","Basic reporting"] },
  PRO:        { price: 99,  shareRate: 0.25, vppShare: 0.05, trial: 14,   leadSuccessFee: 0.05,  // 5% — reward for Pro investment
    features: ["Everything in Free","Priority directory placement","Lead tracking dashboard","Proposal tools","Customer onboarding tools","Utility interconnection tracking","25% recurring referral revenue"] },
  ENTERPRISE: { price: 499, shareRate: 0.30, vppShare: 0.10, trial: null, leadSuccessFee: 0.03,  // 3% — highest tier, lowest fee
    features: ["Everything in Pro","Multi-user accounts","Territory management","CRM integrations","White-label homeowner onboarding","API access","Dedicated account manager","Bulk homeowner imports"] },
};
// Enterprise uses a guided 30-day pilot (sales-assisted), not a self-serve trial.
const ENTERPRISE_PILOT_DAYS = 30;

const upgradeSchema = z.object({
  plan:         z.enum(["FREE","PRO","ENTERPRISE"]),
  paymentMethodId: z.string().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
    select: { id: true, plan: true, membershipMonthlyFee: true, membershipStatus: true,
              membershipRenewsAt: true, revenueSharePct: true, totalReferredUsers: true,
              activeReferredUsers: true, monthlyReferralEarnings: true, referralCode: true },
  });
  if (!installer) return err("Installer account not found.", 404);

  return ok({
    current: installer,
    plans:   PLANS,
    upgradeImpact: {
      fromPro: {
        extraSharePct:      5,
        example500Homes:    500 * 10 * 0.05, // extra $250/mo at 500 homes
        example2000Homes:   2000 * 10 * 0.05,
      },
    },
  });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, upgradeSchema);
  if (error) return err("Validation failed.", 400, error);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const plan     = PLANS[data.plan];
  const prevPlan = PLANS[installer.plan];

  let stripeSubscriptionId = installer.stripeSubscriptionId;

  // Handle Stripe subscription if upgrading to paid plan
  if (plan.price > 0 && data.paymentMethodId) {
    let customerId = (await prisma.user.findUnique({ where: { id: auth.user.id }, select: { stripeCustomerId: true } }))?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: auth.user.email });
      customerId = customer.id;
      await prisma.user.update({ where: { id: auth.user.id }, data: { stripeCustomerId: customerId } });
    }

    // Cancel existing subscription if any
    if (installer.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(installer.stripeSubscriptionId).catch(() => {});
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items:    [{ price_data: { currency: "usd", product_data: { name: `GridGuide Installer ${data.plan}` }, unit_amount: plan.price * 100, recurring: { interval: "month" } } }],
      payment_behavior: "default_incomplete",
      default_payment_method: data.paymentMethodId,
      // 14-day free trial for Pro — no charge during the trial period.
      // Enterprise does not get a self-serve trial; it uses a sales-assisted
      // 30-day guided pilot configured separately by the sales team.
      ...(plan.trial ? { trial_period_days: plan.trial } : {}),
    });
    stripeSubscriptionId = subscription.id;
  }

  const trialEndsAt = plan.trial
    ? new Date(Date.now() + plan.trial * 86400000)
    : null;

  const updated = await prisma.installer.update({
    where: { id: installer.id },
    data: {
      plan:                 data.plan,
      membershipMonthlyFee: plan.price,
      revenueSharePct:      plan.shareRate,
      membershipRenewsAt:   new Date(Date.now() + 30 * 86400000),
      trialEndsAt,          // null for Free/Enterprise, 14 days out for Pro
      ...(stripeSubscriptionId && { stripeSubscriptionId }),
    },
  });

  return ok({
    installer: { plan: updated.plan, membershipMonthlyFee: updated.membershipMonthlyFee, revenueSharePct: updated.revenueSharePct, trialEndsAt: updated.trialEndsAt },
    trialDays: plan.trial,
    message: plan.trial
      ? `Your ${data.plan} plan trial starts now — free for ${plan.trial} days, then $${plan.price}/month. Cancel any time before day ${plan.trial} and you won't be charged.`
      : `Successfully upgraded to ${data.plan} plan. Revenue share is now ${Math.round(plan.shareRate * 100)}%.`,
  });
}
