/**
 * GET   /api/installers/membership  — current plan + plan options (live, admin-configured)
 * POST  /api/installers/membership  — change plan
 *
 * Paid plans (PRO / ENTERPRISE) are NEVER granted here. POST returns a Stripe
 * Checkout URL; access is granted only by the webhook
 * (app/api/payments/webhook) after Stripe confirms the subscription is
 * active or trialing. Previously this route set plan=ENTERPRISE for any
 * caller, with or without a payment method, so anyone could self-upgrade free.
 *
 * Downgrading to FREE cancels the Stripe subscription and applies Free
 * economics immediately.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { stripe } from "@/lib/stripe.js";
import { getInstallerPlans, installerPlanFields } from "@/lib/installer-plans.js";
import { z } from "zod";

const changeSchema = z.object({
  plan: z.enum(["FREE", "PRO", "ENTERPRISE"]),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where: { userId: auth.user.id },
    select: {
      id: true, plan: true, membershipMonthlyFee: true, membershipStatus: true,
      membershipRenewsAt: true, trialEndsAt: true, revenueSharePct: true, successFeeRate: true,
      totalReferredUsers: true, activeReferredUsers: true, monthlyReferralEarnings: true, referralCode: true,
      stripeSubscriptionId: true,
    },
  });
  if (!installer) return err("Installer account not found.", 404);

  const { stripeSubscriptionId, ...current } = installer;
  return ok({ current: { ...current, hasSubscription: !!stripeSubscriptionId }, plans: await getInstallerPlans() });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, changeSchema);
  if (error) return err("Validation failed.", 400, error);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  // ── Downgrade to Free: cancel billing, apply Free economics now ──────────
  if (data.plan === "FREE") {
    if (installer.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(installer.stripeSubscriptionId);
      } catch (e) {
        // Already-cancelled subscriptions are fine; anything else must not
        // silently leave the installer billed while showing Free.
        if (e?.code !== "resource_missing") return err("Could not cancel your subscription. Please try again.", 502);
      }
    }
    const updated = await prisma.installer.update({
      where: { id: installer.id },
      data: {
        ...(await installerPlanFields("FREE")),
        membershipStatus: "active",
        stripeSubscriptionId: null,
        trialEndsAt: null,
        membershipRenewsAt: null,
      },
    });
    return ok({ installer: { plan: updated.plan }, message: "You're now on the Free plan." });
  }

  if (installer.plan === data.plan && ["active", "trialing"].includes(installer.membershipStatus)) {
    return err(`You're already on the ${data.plan} plan.`, 409);
  }

  // ── Paid plan: send to Stripe Checkout; webhook grants access ────────────
  const plans = await getInstallerPlans();
  const plan  = plans[data.plan];
  if (!(plan.price > 0)) return err("This plan is not available for checkout.", 400);

  const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { id: true, email: true, stripeCustomerId: true } });
  let customerId = user?.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
    customerId = customer.id;
    await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
  }

  const origin   = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const metadata = { type: "installer_membership", installerId: installer.id, userId: user.id, plan: data.plan };
  // A Pro trial is offered once; an installer who already used it pays from day one.
  const trialDays = plan.trial && !installer.trialEndsAt ? plan.trial : null;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{
      price_data: {
        currency: "usd",
        product_data: { name: `GridGuide Installer ${data.plan}` },
        unit_amount: Math.round(plan.price * 100),
        recurring: { interval: "month" },
      },
      quantity: 1,
    }],
    success_url: `${origin}/portals/installer?tab=payments&membership=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}/portals/installer?tab=payments&membership=cancelled`,
    metadata,
    subscription_data: { metadata, ...(trialDays ? { trial_period_days: trialDays } : {}) },
  });

  return ok({
    checkoutUrl: session.url,
    trialDays,
    message: trialDays
      ? `Start your ${trialDays}-day ${data.plan} trial. You won't be charged until it ends, and you can cancel any time before then.`
      : `Continue to checkout to start ${data.plan} at $${plan.price}/month.`,
  });
}
