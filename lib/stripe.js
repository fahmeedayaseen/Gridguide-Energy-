import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

// ─── Enterprise subscriptions (Phases 2/3/6) ────────────────────────────────────
// Two-item subscription: the org's own base plan, plus a quantity-based
// item for sponsored homeowner seats (starts at 0, updated via
// updateSponsorshipSeatQuantity as sponsorships are added/removed).
export async function createEnterpriseSubscription({ customerId, basePriceId }) {
  return stripe.subscriptions.create({
    customer: customerId,
    items: [
      { price: basePriceId },
      { price: PRICES.ENTERPRISE_SPONSORED_SEAT, quantity: 0 },
    ],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
  });
}

export async function updateSponsorshipSeatQuantity({ subscriptionItemId, quantity }) {
  return stripe.subscriptionItems.update(subscriptionItemId, {
    quantity,
    proration_behavior: "create_prorations",
  });
}

export async function changeEnterpriseSubscriptionPrice({ subscriptionId, basePriceId, baseItemId }) {
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: baseItemId, price: basePriceId }],
    proration_behavior: "create_prorations",
  });
}

// ─── Billing portal (customer manages their own subscription/payment method) ──
export async function createBillingPortalSession({ customerId, returnUrl }) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session;
}

// ─── Marketplace checkout (customer pays GridGuide) ────────────────────────────
export async function createCheckoutSession({
  userId,
  orderId,
  items,
  successUrl,
  cancelUrl,
  customerEmail,
}) {
  const lineItems = items.map((item) => ({
    price_data: {
      currency: "usd",
      product_data: {
        name: item.name,
        images: item.images?.slice(0, 1) || [],
        metadata: { productId: item.productId },
      },
      unit_amount: Math.round(item.price * 100), // cents
    },
    quantity: item.quantity,
  }));

  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card", "us_bank_account"],
    line_items: lineItems,
    customer_email: customerEmail,
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: { userId, orderId },
    payment_intent_data: {
      metadata: { userId, orderId, type: "marketplace" },
    },
  });
}

// ─── Create Connected Account (for sellers/installers) ─────────────────────────
export async function createConnectedAccount({ email, type = "express", country = "US" }) {
  return stripe.accounts.create({
    type,
    country,
    email,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
  });
}

export function createAccountLink(accountId, { refreshUrl, returnUrl }) {
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });
}

// ─── Transfer payout to seller ─────────────────────────────────────────────────
export async function transferToSeller({
  stripeAccountId,
  amount, // in dollars
  metadata = {},
}) {
  return stripe.transfers.create({
    amount: Math.round(amount * 100),
    currency: "usd",
    destination: stripeAccountId,
    metadata,
  });
}

// ─── Transfer payout to installer ─────────────────────────────────────────────
export async function transferToInstaller({
  stripeAccountId,
  amount,
  metadata = {},
}) {
  return stripe.transfers.create({
    amount: Math.round(amount * 100),
    currency: "usd",
    destination: stripeAccountId,
    metadata: { type: "installer_job", ...metadata },
  });
}

// ─── VPP batch ACH payouts to homeowners ──────────────────────────────────────
export async function createVppBatchPayouts(payouts) {
  // payouts: [{ stripeCustomerId, amount, metadata }]
  const results = [];

  for (const payout of payouts) {
    try {
      const payoutObj = await stripe.payouts.create(
        {
          amount: Math.round(payout.amount * 100),
          currency: "usd",
          method: "instant", // or "standard" for ACH
          metadata: { type: "vpp_payout", ...payout.metadata },
        },
        { stripeAccount: payout.stripeCustomerId }
      );
      results.push({ success: true, id: payoutObj.id, ...payout.metadata });
    } catch (err) {
      results.push({ success: false, error: err.message, ...payout.metadata });
    }
  }

  return results;
}

// ─── Subscription (Pro plan) ──────────────────────────────────────────────────
export async function createSubscription({ customerId, priceId, trialDays = 0 }) {
  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: trialDays || undefined,
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["latest_invoice.payment_intent"],
  });
}


// ─── Consumer membership checkout ────────────────────────────────────────────
export async function createMembershipCheckoutSession({
  user,
  plan,
  priceId,
  successUrl,
  cancelUrl,
}) {
  const customer = user.stripeCustomerId
    ? user.stripeCustomerId
    : undefined;

  return stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    customer,
    customer_email: customer ? undefined : user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${successUrl}?membership=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${cancelUrl}?membership=cancelled&plan=${plan}`,
    allow_promotion_codes: true,
    metadata: { userId: user.id, plan, type: "consumer_membership" },
    subscription_data: {
      metadata: { userId: user.id, plan, type: "consumer_membership" },
    },
  });
}

// ─── Webhook signature verification ───────────────────────────────────────────
export function constructWebhookEvent(payload, sig) {
  return stripe.webhooks.constructEvent(
    payload,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

// ─── Price IDs (set in Stripe dashboard, reference by env) ────────────────────
export const PRICES = {
  CONSUMER_PRO:       process.env.STRIPE_PRICE_CONSUMER_PRO    || "price_...",
  CONSUMER_ENTERPRISE: process.env.STRIPE_PRICE_CONSUMER_ENTERPRISE || "price_...",
  SELLER_PRO:         process.env.STRIPE_PRICE_SELLER_PRO      || "price_...",
  INSTALLER_PRO:      process.env.STRIPE_PRICE_INSTALLER_PRO   || "price_...",
  INSTALLER_ENTERPRISE:    process.env.STRIPE_PRICE_INSTALLER_ENTERPRISE || "price_...",
  ENTERPRISE_BASIC:        process.env.STRIPE_PRICE_ENTERPRISE_BASIC        || "price_...",
  ENTERPRISE_PRO:          process.env.STRIPE_PRICE_ENTERPRISE_PRO          || "price_...",
  ENTERPRISE_SCALE:        process.env.STRIPE_PRICE_ENTERPRISE_SCALE        || "price_...",
  ENTERPRISE_BASIC_ANNUAL: process.env.STRIPE_PRICE_ENTERPRISE_BASIC_ANNUAL || "price_...",
  ENTERPRISE_PRO_ANNUAL:   process.env.STRIPE_PRICE_ENTERPRISE_PRO_ANNUAL   || "price_...",
  ENTERPRISE_SCALE_ANNUAL: process.env.STRIPE_PRICE_ENTERPRISE_SCALE_ANNUAL || "price_...",
  ENTERPRISE_SPONSORED_SEAT: process.env.STRIPE_PRICE_ENTERPRISE_SPONSORED_SEAT || "price_...",
};

// ─── Commission rates ─────────────────────────────────────────────────────────
export const COMMISSION = {
  SELLER_FREE:     0.10, // 10%
  SELLER_PRO:      0.08, // 8%
  INSTALLER_BASIC: 0.10, // 8–10%
  INSTALLER_PRO:   0.06, // 5–7%
  INSTALLER_ENTERPRISE: 0.04, // 3–5%
  VPP:             0.10, // 10% of VPP earnings
};

export function calculateFees(amount, role, plan) {
  let rate = COMMISSION.SELLER_FREE;
  if (role === "SELLER" && plan === "PRO") rate = COMMISSION.SELLER_PRO;
  if (role === "INSTALLER") {
    if (plan === "PRO") rate = COMMISSION.INSTALLER_PRO;
    else if (plan === "ENTERPRISE") rate = COMMISSION.INSTALLER_ENTERPRISE;
    else rate = COMMISSION.INSTALLER_BASIC;
  }
  const commission = amount * rate;
  const processingFee = amount * 0.029 + 0.30; // Stripe 2.9% + $0.30
  const net = amount - commission - processingFee;
  return { commission, processingFee, net, rate };
}
