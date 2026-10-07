/**
 * Phase 5: real permission enforcement for the Enterprise Portal.
 *
 * Rank-based on purpose: Viewer(0) < Manager(1) < Admin(2) < Owner(3).
 * Using a monotonic rank (rather than a per-route allowlist) makes
 * "Viewer can never see more than Manager" structural rather than a rule
 * that has to be remembered at every call site - a route gated at
 * Manager-or-above by construction excludes Viewer, full stop.
 *
 * Two families of guard:
 *   - requireEnterpriseRole(userId, minRole): for operational routes
 *     (dashboard, properties, fleet, analytics, revenue, carbon,
 *     device-links, homeowner-invites) where access scales by rank.
 *   - requireEnterpriseAdmin / requireEnterpriseOwner: for
 *     billing/team/settings/api-keys/sponsorships/installer-network
 *     writes, which are Admin-or-Owner (or Owner-only for billing)
 *     regardless of rank - these are NOT "Manager-or-above", they are a
 *     hard floor at Admin, per the approved matrix explicitly excluding
 *     Manager from billing/team/settings.
 */
import { prisma } from "@/lib/db.js";

export const ROLE_RANK = { Viewer: 0, Manager: 1, Admin: 2, Owner: 3 };

/**
 * Resolves which EnterpriseOrg (if any) a user has access to, and at what
 * role. The org owner is resolved directly via EnterpriseOrg.ownerUserId -
 * they are not an EnterpriseTeamMember row. Everyone else must be an
 * ACTIVE EnterpriseTeamMember with a linked userId.
 */
export async function resolveEnterpriseAccess(userId) {
  const ownedOrg = await prisma.enterpriseOrg.findUnique({ where: { ownerUserId: userId } });
  if (ownedOrg) return { org: ownedOrg, role: "Owner", member: null };

  const membership = await prisma.enterpriseTeamMember.findFirst({
    where: { userId, status: "ACTIVE" },
    include: { org: true },
  });
  if (membership) return { org: membership.org, role: membership.role, member: membership };

  return null;
}

export async function requireEnterpriseRole(userId, minRole) {
  const access = await resolveEnterpriseAccess(userId);
  if (!access) return { allowed: false, status: 404, error: "Enterprise organization not found" };
  if (ROLE_RANK[access.role] < ROLE_RANK[minRole]) {
    return { allowed: false, status: 403, error: `This action requires ${minRole} access or higher.` };
  }
  return { allowed: true, org: access.org, role: access.role };
}

/** Billing, team management, settings, API keys - Admin or Owner only. */
export async function requireEnterpriseAdmin(userId) {
  return requireEnterpriseRole(userId, "Admin");
}

/** Billing specifically - Owner only, per the approved matrix (Admin is explicitly excluded from billing). */
export async function requireEnterpriseOwner(userId) {
  return requireEnterpriseRole(userId, "Owner");
}
