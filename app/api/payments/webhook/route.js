/**
 * POST /api/payments/webhook
 * Stripe webhook handler — subscription lifecycle, installer commission
 * (recalculated every cycle off the installer's CURRENT plan tier), and
 * homeowner referral credit bonuses.
 */
import { stripe, PRICES, calculateFees } from "@/lib/stripe.js";
import { prisma }               from "@/lib/db.js";
import { ok, err }              from "@/lib/auth.js";
import { headers }              from "next/headers";
import { getPlatformConfig }    from "@/lib/platform-config.js";
import { calculateAndRecordCommission } from "@/lib/installer-commission.js";
import { sendOrderConfirmation } from "@/lib/email.js";
import { awardHomeownerReferralCredits } from "@/lib/credits.js";

// Maps a Stripe price ID to the homeowner-facing plan. Sourced from
// lib/stripe.js's PRICES (the same map used to CREATE checkout sessions in
// app/api/memberships/checkout/route.js) so there is exactly one place price
// IDs are configured — previously this file read a second, different set of
// env var names (STRIPE_CONSUMER_PLUS_PRICE_ID etc.) and mapped to "PLUS"/
// "PREMIUM", neither of which was a valid Plan enum value at the time
// (FREE|PRO|ENTERPRISE — see prisma/schema.prisma). That meant
// prisma.user.update() below would throw on every real subscription event,
// so no homeowner who actually paid ever got upgraded. The enum has since
// been renamed to HOMEOWNER_FREE|HOMEOWNER_PLUS|HOMEOWNER_PREMIUM — "PLUS"/
// "PREMIUM" are valid again now, just with that prefix. Add new tiers by
// adding a PRICES entry in lib/stripe.js, not by editing this map.
const HOMEOWNER_PLAN_BY_PRICE = {
  [PRICES.CONSUMER_PRO]:        "HOMEOWNER_PLUS",
  [PRICES.CONSUMER_ENTERPRISE]: "HOMEOWNER_PREMIUM",
};

export async function POST(request) {
  const body      = await request.text();
  const signature = headers().get("stripe-signature");

  // Fail closed: no secret configured = no event is trusted, on any environment.
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[Stripe webhook] STRIPE_WEBHOOK_SECRET is not set — rejecting event.");
    return err("Webhook not configured", 500);
  }
  if (!signature) return err("Missing Stripe signature", 400);

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (e) {
    return err("Webhook signature verification failed", 400);
  }

  const cfg = await getPlatformConfig();

  switch (event.type) {

    // ── Subscription created or updated ─────────────────────────────────────
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub     = event.data.object;
      const priceId = sub.items.data[0]?.price?.id;
      const plan    = HOMEOWNER_PLAN_BY_PRICE[priceId] || "HOMEOWNER_PLUS";

      const user = await prisma.user.findFirst({
        where:  { stripeCustomerId: sub.customer },
        select: { id: true, email: true, plan: true },
      });
      if (!user) break;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          plan,
          stripeSubscriptionId: sub.id,
          subscriptionStatus:   sub.status,
          currentPeriodEnd:     new Date(sub.current_period_end * 1000),
        },
      });

      // ── Homeowner-to-homeowner referral: award credits on real activation,
      //    not at signup. "Activates/pays" means a genuinely active paid
      //    subscription - sub.status === "active" excludes a trial that
      //    hasn't actually been charged yet. Gating on status: "signed_up"
      //    makes this naturally idempotent: customer.subscription.updated
      //    can fire many times over a subscription's life (plan changes,
      //    renewals), but once this referral has been advanced to
      //    "subscribed" it will never match this query again, so credits
      //    are never awarded twice for the same referral.
      if (plan !== "HOMEOWNER_FREE" && sub.status === "active") {
        // Atomic check-and-transition: status is part of the WHERE clause
        // itself, not a separate findFirst-then-update. Stripe commonly
        // delivers customer.subscription.created and .updated for the same
        // subscription close together - if both webhook calls were
        // processed concurrently, a separate read-then-write could let both
        // pass the "is this still signed_up" check before either commits,
        // double-awarding credits. With the status in the WHERE clause,
        // only one concurrent update can ever actually match and apply;
        // count === 1 is the only path that awards credits.
        const referral = await prisma.homeownerReferral.findFirst({
          where: { referredUserId: user.id, status: "signed_up" },
          select: { id: true, referrerId: true },
        }).catch(() => null);

        if (referral) {
          const { count } = await prisma.homeownerReferral.updateMany({
            where: { id: referral.id, status: "signed_up" },
            data:  { status: "subscribed", rewardedAt: new Date() },
          });

          if (count === 1) {
            await awardHomeownerReferralCredits(referral.referrerId, referral.id)
              .catch((e) => console.error("[Webhook] Homeowner referral credit award failed:", e.message));

            await prisma.notification.create({
              data: {
                userId:  referral.referrerId,
                type:    "REFERRAL_SUBSCRIBED",
                title:   "Your referral just subscribed!",
                message: `Your referred friend activated their GridGuide plan. You earned ${cfg.homeownerReferralCredits.toLocaleString()} credits ($${(cfg.homeownerReferralCredits / cfg.creditsPerDollar).toFixed(2)})!`,
              },
            }).catch(() => {});
          }
        }
      }

      // ── Installer referral conversion — homeownerRevenue uses the ACTUAL
      //    amount Stripe is charging this homeowner this cycle, not a single
      //    global price. This means if GridGuide later adds a higher tier
      //    (e.g. $19.99 Premium alongside $9.99 Plus), installers automatically
      //    earn their % of whatever the homeowner is really paying — no code
      //    change needed when new homeowner plans are introduced. ─────────────
      const referrals = await prisma.installerReferral.findMany({
        where:   { userId: user.id, verified: true },
        include: { installer: { select: { id: true, userId: true, plan: true } } },
      });

      // unit_amount is in cents; fall back to the platform default only if
      // Stripe didn't return a price (shouldn't normally happen)
      const priceObj      = sub.items.data[0]?.price;
      const actualMonthly = plan === "HOMEOWNER_FREE"
        ? 0
        : (priceObj?.unit_amount != null ? priceObj.unit_amount / 100 : cfg.homeownerSubscriptionPrice);

      for (const ref of referrals) {
        // Mark as subscribed and record this cycle's ACTUAL revenue; the
        // commission % is always recalculated from the installer's CURRENT
        // plan tier inside calculateAndRecordCommission(), never cached.
        await prisma.installerReferral.update({
          where: { id: ref.id },
          data: {
            conversionStatus: "subscribed",
            userPlan:         plan,
            monthlyRevenue:   actualMonthly,
            subscribedAt:     ref.subscribedAt || new Date(),
          },
        });

        // P1: Keep InstallerCustomerInvite in sync — move SIGNED_UP → SUBSCRIBED
        // so invitation funnel analytics and campaign signupCount stay accurate.
        await prisma.installerCustomerInvite.updateMany({
          where: {
            convertedUserId: ref.userId,
            installerId:     ref.installerId,
            status:          "SIGNED_UP",
          },
          data: { status: "SUBSCRIBED", subscribedAt: new Date() },
        }).catch(() => {});

        // Update campaign subscribed analytics
        const updatedInvites = await prisma.installerCustomerInvite.findMany({
          where: { convertedUserId: ref.userId, installerId: ref.installerId },
          select: { campaignId: true },
        }).catch(() => []);
        for (const inv of updatedInvites) {
          if (inv.campaignId) {
            await prisma.installerCampaign.update({
              where: { id: inv.campaignId },
              data:  { signupCount: { increment: 1 } },
            }).catch(() => {});
          }
        }

        const ledgerRow = await calculateAndRecordCommission(ref.id, actualMonthly).catch(e => {
          console.error("[Webhook] Commission calc failed:", e.message);
          return null;
        });

        if (ledgerRow) {
          await prisma.notification.create({
            data: {
              userId:  ref.installer.userId,
              type:    "REFERRAL_CONVERTED",
              title:   "Referral Converted! 🎉",
              message: `A homeowner upgraded to ${plan}. You're earning $${ledgerRow.commissionAmount.toFixed(2)}/month from this referral at your current ${ref.installer.plan} plan rate (${Math.round(ledgerRow.sharePctApplied * 100)}%).`,
            },
          }).catch(() => {});
        }
      }

      break;
    }

    // ── Subscription cancelled ───────────────────────────────────────────────
    case "customer.subscription.deleted": {
      const sub  = event.data.object;
      const user = await prisma.user.findFirst({ where: { stripeCustomerId: sub.customer } });
      if (!user) break;

      await prisma.user.update({
        where: { id: user.id },
        data:  { plan: "HOMEOWNER_FREE", subscriptionStatus: "canceled" },
      });

      await prisma.installerReferral.updateMany({
        where: { userId: user.id, conversionStatus: "subscribed" },
        data:  { conversionStatus: "activated", monthlyRevenue: 0, installerShare: 0 },
      }).catch(() => {});
      break;
    }

    // ── Successful payment — runs commission ledger + credit redemption ──────
    case "invoice.payment_succeeded": {
      const invoice = event.data.object;
      if (invoice.billing_reason !== "subscription_cycle") break;

      const user = await prisma.user.findFirst({ where: { stripeCustomerId: invoice.customer } });
      if (!user) break;

      // ── Re-run installer commission for this billing cycle ─────────────────
      // (idempotent — upserts on installerReferralId + period, always reads
      //  the installer's CURRENT plan so a mid-cycle upgrade/downgrade is honored
      //  starting the NEXT billing month, as required.)
      const referrals = await prisma.installerReferral.findMany({
        where: { userId: user.id, conversionStatus: "subscribed", verified: true },
      });

      const billingDate = new Date(invoice.period_start * 1000);
      for (const ref of referrals) {
        const ledgerRow = await calculateAndRecordCommission(ref.id, ref.monthlyRevenue, billingDate).catch(() => null);
        if (ledgerRow) {
          await prisma.installerRevenueShare.create({
            data: {
              installerId:      ref.installerId,
              periodStart:      new Date(invoice.period_start * 1000),
              periodEnd:        new Date(invoice.period_end   * 1000),
              activeHomeowners: 1,
              totalSubscriptionRevenue: ref.monthlyRevenue,
              sharePercentage:  ledgerRow.sharePctApplied,
              grossShareAmount: ledgerRow.commissionAmount,
              netPayout:        ledgerRow.commissionAmount,
              status:           "PENDING",
            },
          }).catch(() => {});
        }
      }

      // ── Apply any pending credit redemption as a line-item credit ──────────
      // (handled separately via /api/rewards/redeem at the user's request;
      //  no automatic deduction here to keep redemption an explicit action.)

      // ── Homeowner-to-homeowner referral: NOT handled here. ──────────────────
      // This block only fires on renewal cycles (billing_reason ===
      // "subscription_cycle" excludes a subscription's first invoice), so it
      // could never fire on a homeowner's first payment - referral credits
      // would be awarded a full month late, or never, for anyone whose
      // subscription.updated event was missed. Real activation handling
      // (crediting the referrer once the subscription actually goes active)
      // now lives in the customer.subscription.created/updated case above,
      // which is the genuine first-payment moment.

      break;
    }

    // ── Marketplace order paid — the other half of the checkout flow that
    //    POST /api/marketplace/orders starts. Without this handler, an Order
    //    is created as PENDING and a Stripe session is issued, but nothing
    //    ever runs when the buyer actually pays: the order never becomes PAID,
    //    no SellerPayout rows are created (so processBiweeklySellerPayouts in
    //    lib/cron.js has nothing to ever pay out), inventory is never
    //    decremented, and no confirmation is sent. ──────────────────────────
    case "checkout.session.completed": {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      if (!orderId) break; // not a marketplace checkout (e.g. a different flow using Stripe Checkout)

      const order = await prisma.order.findUnique({
        where:   { id: orderId },
        include: {
          items: { include: { product: { include: { seller: true } } } },
          user:  true,
        },
      });
      // Idempotent: Stripe can retry webhook delivery: skip if already processed
      if (!order || order.status !== "PENDING") break;

      // Group line items by seller — an order can span multiple sellers, and
      // each seller's commission must use THEIR OWN plan, not a single
      // hardcoded rate for the whole order (that was the previous bug in
      // POST /api/marketplace/orders — every order was estimated at the
      // FREE-tier 10% rate even for sellers actually paying for PRO's 8%).
      const bySeller = {};
      for (const item of order.items) {
        const sellerId = item.product.sellerId;
        if (!bySeller[sellerId]) bySeller[sellerId] = { seller: item.product.seller, items: [], gross: 0 };
        bySeller[sellerId].items.push(item);
        bySeller[sellerId].gross += item.price * item.quantity;
      }

      let totalCommission = 0, totalProcessingFee = 0;
      // Stagger payouts onto GridGuide's biweekly payout cadence, matching
      // processBiweeklySellerPayouts()'s scheduledFor <= now check.
      const scheduledFor = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      for (const sellerId of Object.keys(bySeller)) {
        const { seller, items, gross } = bySeller[sellerId];
        const { commission, processingFee, net } = calculateFees(gross, "SELLER", seller.plan);
        totalCommission += commission;
        totalProcessingFee += processingFee;

        await prisma.sellerPayout.create({
          data: {
            sellerId, orderId, grossAmount: gross, commission,
            processingFee, netAmount: net, status: "PENDING", scheduledFor,
          },
        }).catch(e => console.error("[Webhook] SellerPayout create failed:", e.message));

        for (const item of items) {
          await prisma.product.update({
            where: { id: item.productId },
            data:  { inventory: { decrement: item.quantity }, soldCount: { increment: item.quantity } },
          }).catch(() => {}); // don't fail the whole webhook over an inventory update
        }
      }

      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: "PAID",
          stripePaymentId: session.payment_intent,
          commission:      totalCommission,      // replaces the pre-payment estimate with the real, per-seller-correct total
          processingFee:   totalProcessingFee,
        },
        include: { items: { include: { product: true } } },
      });

      await sendOrderConfirmation(order.user, updatedOrder).catch(e => console.error("[Webhook] Order confirmation email failed:", e.message));
      await prisma.notification.create({
        data: {
          userId:  order.userId,
          type:    "ORDER_CONFIRMED",
          title:   "Order Confirmed",
          message: `Your order #${orderId.slice(-8).toUpperCase()} for $${order.total.toFixed(2)} has been confirmed.`,
        },
      }).catch(() => {});

      break;
    }
  }

  return ok({ received: true });
}
