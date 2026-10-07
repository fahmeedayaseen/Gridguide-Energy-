// GridGuide membership rules and helpers
// Consumer plans: HOMEOWNER_FREE, HOMEOWNER_PLUS, HOMEOWNER_PREMIUM

export const MEMBERSHIP_PLANS = {
  HOMEOWNER_FREE: {
    id: "HOMEOWNER_FREE",
    name: "Free",
    priceMonthly: 0,
    stripeEnv: null,
    cta: "Get Started Free",
    href: "/register?plan=HOMEOWNER_FREE",
    description: "Basic home energy dashboard for homeowners getting started.",
    limits: {
      devices: 1,
      utilityConnections: 1,
      aiMessagesPerHour: 10,
      properties: 1,
      teamMembers: 1,
      apiAccess: false,
      whiteLabelReports: false,
      prioritySupport: false,
      vppParticipation: false,
      advancedOptimization: false,
    },
    features: [
      "Home energy dashboard",
      "1 connected device",
      "Basic AI recommendations",
      "Rewards tracking",
      "One utility connection",
    ],
  },
  HOMEOWNER_PLUS: {
    id: "HOMEOWNER_PLUS",
    name: "Plus",
    priceMonthly: 9.99,
    stripeEnv: "STRIPE_PRICE_CONSUMER_PRO",
    cta: "Upgrade to Plus",
    href: "/api/memberships/checkout?plan=HOMEOWNER_PLUS",
    description: "Advanced AI optimization for active energy households.",
    limits: {
      devices: -1,
      utilityConnections: -1,
      aiMessagesPerHour: 60,
      properties: 1,
      teamMembers: 1,
      apiAccess: false,
      whiteLabelReports: false,
      prioritySupport: true,
      vppParticipation: true,
      advancedOptimization: true,
    },
    features: [
      "Everything in Free",
      "Unlimited devices and utility connections",
      "Advanced AI energy optimization",
      "VPP participation and demand response earnings",
      "EV charging and battery optimization",
      "Priority support",
    ],
  },
  HOMEOWNER_PREMIUM: {
    id: "HOMEOWNER_PREMIUM",
    name: "Pro",
    priceMonthly: 19.99,
    stripeEnv: "STRIPE_PRICE_CONSUMER_ENTERPRISE",
    cta: "Upgrade to Pro",
    href: "/api/memberships/checkout?plan=HOMEOWNER_PREMIUM",
    description: "Maximum optimization and priority access for power users.",
    limits: {
      devices: -1,
      utilityConnections: -1,
      aiMessagesPerHour: 300,
      properties: 1,
      teamMembers: 1,
      apiAccess: true,
      whiteLabelReports: false,
      prioritySupport: true,
      vppParticipation: true,
      advancedOptimization: true,
    },
    features: [
      "Everything in Plus",
      "Highest AI usage tier",
      "API access for custom integrations",
      "Fastest priority support",
    ],
  },
};

export function normalizePlan(plan = "HOMEOWNER_FREE") {
  const key = String(plan || "HOMEOWNER_FREE").toUpperCase();
  return MEMBERSHIP_PLANS[key] ? key : "HOMEOWNER_FREE";
}

export function getMembership(plan = "HOMEOWNER_FREE") {
  return MEMBERSHIP_PLANS[normalizePlan(plan)];
}

export function isUnlimited(value) {
  return value === -1;
}

export function hasFeature(plan, featureName) {
  const membership = getMembership(plan);
  return Boolean(membership.limits?.[featureName]);
}

export function getLimit(plan, limitName) {
  return getMembership(plan).limits?.[limitName];
}

export function assertFeature(plan, featureName, label = featureName) {
  if (!hasFeature(plan, featureName)) {
    return {
      allowed: false,
      status: 403,
      error: `${label} requires a Plus or Pro membership.`,
      upgradeRequired: true,
      requiredPlan: "HOMEOWNER_PLUS",
    };
  }
  return { allowed: true };
}

export function assertLimit(plan, limitName, currentCount, label = limitName) {
  const limit = getLimit(plan, limitName);
  if (isUnlimited(limit) || limit === undefined) return { allowed: true, limit };
  if (currentCount < limit) return { allowed: true, limit };
  return {
    allowed: false,
    status: 403,
    error: `${label} limit reached for your ${getMembership(plan).name} membership.`,
    upgradeRequired: true,
    requiredPlan: "HOMEOWNER_PLUS",
    limit,
  };
}

export function publicMembershipPayload(baseUrl = "") {
  return Object.values(MEMBERSHIP_PLANS).map((plan) => ({
    ...plan,
    checkoutUrl:
      plan.id === "HOMEOWNER_FREE" ? `${baseUrl}/register?plan=HOMEOWNER_FREE` :
      `${baseUrl}/api/memberships/checkout?plan=${plan.id}`,
  }));
}

// ── Plan feature gates called at API layer ────────────────────────────────────

/**
 * assertAdvancedOptimization — gates battery/EV optimization endpoints.
 * Free plan homeowners can monitor but not configure automated optimization.
 */
export function assertAdvancedOptimization(plan) {
  return assertFeature(plan, "advancedOptimization", "Advanced energy optimization");
}

/**
 * assertApiAccess — gates the /api/v1/* public REST API.
 * Only Pro (HOMEOWNER_PREMIUM) homeowners can generate API keys.
 */
export function assertApiAccess(plan) {
  return assertFeature(plan, "apiAccess", "API access");
}

/**
 * getAiForecastTier — returns the forecast resolution the plan is allowed.
 * Free = daily summaries only. Plus = hourly. Pro = real-time streaming.
 */
export function getAiForecastTier(plan) {
  const tiers = {
    HOMEOWNER_FREE:    "daily",
    HOMEOWNER_PLUS:    "hourly",
    HOMEOWNER_PREMIUM: "realtime",
  };
  return tiers[normalizePlan(plan)] ?? "daily";
}

/**
 * assertForecastTier — blocks access to higher-resolution forecast data.
 * Pass the requested tier ("daily" | "hourly" | "realtime").
 */
export function assertForecastTier(plan, requestedTier) {
  const TIER_RANK = { daily: 1, hourly: 2, realtime: 3 };
  const allowed = getAiForecastTier(plan);
  if ((TIER_RANK[requestedTier] ?? 1) <= (TIER_RANK[allowed] ?? 1)) return { allowed: true };
  return {
    allowed: false,
    status: 403,
    error: `${requestedTier} forecast data requires a ${requestedTier === "realtime" ? "Pro" : "Plus"} membership.`,
    upgradeRequired: true,
    requiredPlan: requestedTier === "realtime" ? "HOMEOWNER_PREMIUM" : "HOMEOWNER_PLUS",
  };
}
