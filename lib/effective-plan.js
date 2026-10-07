/**
 * Phase 3: effective plan computation. User.plan is NEVER overwritten by
 * sponsorship - this computes the max of the homeowner's own plan and any
 * active EnterpriseSponsorship at read time.
 *
 * Every plan-gated feature that previously read user.plan directly should
 * call getEffectivePlanForUser(userId) (or getEffectivePlan(user, sponsorship)
 * if the sponsorship row is already in hand) instead - see
 * DEPLOYMENT_CHECKLIST.md for the audit of call sites migrated as part of
 * this phase.
 */
import { prisma } from "@/lib/db.js";

export const PLAN_RANK = { HOMEOWNER_FREE: 0, HOMEOWNER_PLUS: 1, HOMEOWNER_PREMIUM: 2 };

export function getEffectivePlan(user, activeSponsorship) {
  if (!activeSponsorship) return user.plan;
  const withinGracePeriod = activeSponsorship.status === "ENDED" && activeSponsorship.gracePeriodEndsAt && new Date(activeSponsorship.gracePeriodEndsAt) > new Date();
  if (activeSponsorship.status !== "ACTIVE" && !withinGracePeriod) return user.plan;
  return PLAN_RANK[activeSponsorship.plan] > PLAN_RANK[user.plan] ? activeSponsorship.plan : user.plan;
}

export async function getEffectivePlanForUser(userId) {
  const [user, sponsorship] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true } }),
    prisma.enterpriseSponsorship.findUnique({ where: { userId } }),
  ]);
  if (!user) return null;
  return getEffectivePlan(user, sponsorship);
}
