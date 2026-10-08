/**
 * Installer membership billing — the only code path that grants or removes
 * paid installer plans. Called from the Stripe webhook.
 *
 * Rule: an installer has paid access ONLY while their current Stripe
 * subscription is `active` or `trialing`. past_due, unpaid, incomplete,
 * incomplete_expired, canceled, or a failed invoice all drop the installer
 * to Free economics (plan, success fee and revenue shares together).
 */
import { prisma } from "./db.js";
import { installerPlanFields, PAID_ACCESS_STATUSES, INSTALLER_PLAN_KEYS } from "./installer-plans.js";

const ts = (s) => (s ? new Date(s * 1000) : null);

/**
 * @param {object} sub      Stripe subscription object
 * @param {object} opts
 * @param {string} [opts.installerId]  from checkout metadata
 * @param {string} [opts.plan]         from checkout/subscription metadata
 * @param {boolean} [opts.fromCheckout] true when called for checkout.session.completed
 * @returns {Promise<{installerId:string, plan:string, paid:boolean}|null>}
 */
export async function syncInstallerSubscription(sub, { installerId, plan, fromCheckout = false } = {}) {
  const meta = sub?.metadata || {};
  const id   = installerId || meta.installerId;

  let installer = id ? await prisma.installer.findUnique({ where: { id } }) : null;
  if (!installer && sub?.id) installer = await prisma.installer.findFirst({ where: { stripeSubscriptionId: sub.id } });
  if (!installer) return null;

  // Ignore late events for a subscription the installer has already replaced
  // (e.g. the old sub's `deleted` arriving after they checked out a new plan).
  if (!fromCheckout && installer.stripeSubscriptionId && installer.stripeSubscriptionId !== sub.id) return null;

  const requested = plan || meta.plan;
  const paidPlan  = INSTALLER_PLAN_KEYS.includes(requested) && requested !== "FREE" ? requested : null;
  const paid      = !!paidPlan && PAID_ACCESS_STATUSES.has(sub.status);
  const ended     = ["canceled", "incomplete_expired"].includes(sub.status);

  await prisma.installer.update({
    where: { id: installer.id },
    data: {
      ...(await installerPlanFields(paid ? paidPlan : "FREE")),
      membershipStatus:     sub.status,
      stripeSubscriptionId: ended ? null : sub.id,
      membershipRenewsAt:   paid ? ts(sub.current_period_end) : null,
      ...(sub.status === "trialing" && sub.trial_end ? { trialEndsAt: ts(sub.trial_end) } : {}),
    },
  });

  return { installerId: installer.id, plan: paid ? paidPlan : "FREE", paid };
}

/** invoice.payment_failed for an installer subscription → immediate downgrade. */
export async function downgradeInstallerForFailedPayment(subscriptionId) {
  if (!subscriptionId) return null;
  const installer = await prisma.installer.findFirst({ where: { stripeSubscriptionId: subscriptionId } });
  if (!installer) return null;
  await prisma.installer.update({
    where: { id: installer.id },
    data: { ...(await installerPlanFields("FREE")), membershipStatus: "past_due", membershipRenewsAt: null },
  });
  await prisma.notification.create({
    data: {
      userId:  installer.userId,
      type:    "PAYMENT_FAILED",
      title:   "Membership payment failed",
      message: "We couldn't charge your card, so your account is on the Free plan for now. Update your payment method under Payments to restore your plan.",
    },
  }).catch(() => {});
  return installer.id;
}
