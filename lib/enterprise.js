import { prisma } from "@/lib/db.js";
import { getMembership, assertFeature, assertLimit } from "@/lib/memberships.js";

export function slugifyOrganizationName(name = "") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `org-${Date.now()}`;
}

export async function requireEnterpriseAccess(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, plan: true, role: true },
  });
  if (!user) return { allowed: false, status: 404, error: "User not found" };
  if (user.role === "ADMIN") return { allowed: true, user };
  const feature = assertFeature(user.plan, "apiAccess", "Enterprise organization tools");
  if (!feature.allowed && user.plan !== "HOMEOWNER_PREMIUM") {
    return {
      allowed: false,
      status: 403,
      error: "Enterprise organization tools require an Enterprise membership.",
      upgradeRequired: true,
      requiredPlan: "HOMEOWNER_PREMIUM",
    };
  }
  return { allowed: true, user };
}

export async function requireOrganizationRole(userId, organizationId, roles = ["OWNER", "ADMIN"]) {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, organizationId, status: "ACTIVE" },
    include: { organization: true },
  });
  if (!membership) return { allowed: false, status: 404, error: "Organization not found or access denied" };
  if (!roles.includes(membership.role)) {
    return { allowed: false, status: 403, error: "You do not have permission for this organization action." };
  }
  return { allowed: true, membership, organization: membership.organization };
}

export async function checkPropertyLimit(userId, organizationId = null) {
  if (organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { propertyLimit: true, _count: { select: { properties: true } } },
    });
    if (org && org.propertyLimit !== null && org._count.properties >= org.propertyLimit) {
      return { allowed: false, status: 403, error: "Organization property limit reached.", upgradeRequired: true };
    }
    return { allowed: true };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, _count: { select: { properties: true } } },
  });
  return assertLimit(user?.plan, "properties", user?._count?.properties || 0, "Property");
}

export function calculateGridGuideFee(grossAmount, feePct = 0.1) {
  const gross = Number(grossAmount || 0);
  const pct = Number(feePct || 0);
  const fee = Math.round(gross * pct * 100) / 100;
  return { grossAmount: gross, gridguideFee: fee, netAmount: Math.round((gross - fee) * 100) / 100 };
}

export function enterpriseSummary(org) {
  const plan = getMembership(org?.plan || "HOMEOWNER_PREMIUM");
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    type: org.type,
    plan: org.plan,
    status: org.status,
    apiEnabled: org.apiEnabled,
    whiteLabelEnabled: org.whiteLabelEnabled,
    seatsLimit: org.seatsLimit,
    propertyLimit: org.propertyLimit,
    limits: plan.limits,
    counts: org._count || undefined,
  };
}
