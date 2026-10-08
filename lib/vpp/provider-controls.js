/**
 * VPP provider visibility & enrollment gates — the single place that decides
 * whether a provider is shown to homeowners or can accept enrollments.
 *
 *   publicVisible  — admin switch: provider/programs may appear on public pages
 *   enrollmentOpen — admin switch: homeowners may enroll right now
 *   status         — ACTIVE (live) or SANDBOX (testing) can accept enrollments;
 *                    PENDING_CREDENTIALS / PAUSED / ERROR cannot
 *
 * EnergyHub is double-gated: it is hidden and closed unless BOTH the
 * ENERGYHUB_ENABLED env flag is "true" AND its DB row is ACTIVE. No
 * EnergyHub API contract is implemented anywhere; this only controls
 * visibility so nothing is shown before a real integration exists.
 */

const ENROLLABLE_STATUSES = new Set(["ACTIVE", "SANDBOX"]);

export function isEnergyHubEnabled() {
  return process.env.ENERGYHUB_ENABLED === "true";
}

function energyHubBlocked(provider) {
  return provider?.key === "energyhub" && (!isEnergyHubEnabled() || provider.status !== "ACTIVE");
}

/** May this provider (and its programs) be shown to homeowners/public? */
export function isProviderPubliclyVisible(provider) {
  if (!provider) return false;
  if (energyHubBlocked(provider)) return false;
  return provider.publicVisible === true && ENROLLABLE_STATUSES.has(provider.status);
}

/** May a homeowner enroll in this provider's programs right now? */
export function canProviderAcceptEnrollment(provider) {
  if (!isProviderPubliclyVisible(provider)) return false;
  return provider.enrollmentOpen === true;
}

/** Human-readable reason an enrollment was refused (for API errors). */
export function enrollmentBlockReason(provider) {
  if (!provider) return "This program's provider is not available.";
  if (energyHubBlocked(provider)) return "This provider is not available yet.";
  if (!ENROLLABLE_STATUSES.has(provider.status)) return `${provider.name} isn't accepting enrollments right now.`;
  if (!provider.publicVisible) return `${provider.name} isn't available yet.`;
  if (!provider.enrollmentOpen) return `Enrollment with ${provider.name} is currently closed.`;
  return null;
}

/** Prisma `where` fragment for providers that can take enrollments. */
export function enrollableProviderWhere() {
  const where = { status: { in: [...ENROLLABLE_STATUSES] }, publicVisible: true, enrollmentOpen: true };
  if (!isEnergyHubEnabled()) where.key = { not: "energyhub" };
  return where;
}
