/**
 * GridGuide VPP partner integration layer.
 * This file centralizes Leap, Enel, and future-partner routing logic.
 * It is production-safe: no fake enrollments/events are created without API/webhook input.
 */
import axios from "axios";

export const VPP_PROVIDER_CONFIG = {
  leap: {
    key: "leap",
    name: "Leap",
    env: ["LEAP_API_KEY", "LEAP_API_BASE_URL", "LEAP_WEBHOOK_SECRET"],
    defaultBaseUrl: "https://api.leap.energy",
  },
  enel: {
    key: "enel",
    name: "Enel X / Enel Grid Services",
    env: ["ENEL_API_KEY", "ENEL_API_BASE_URL", "ENEL_WEBHOOK_SECRET"],
    defaultBaseUrl: "https://api.enelx.com",
  },
};

export function normalizeProviderKey(provider) {
  return String(provider || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

export function getProviderEnv(providerKey) {
  const key = normalizeProviderKey(providerKey);
  const cfg = VPP_PROVIDER_CONFIG[key] || { key, name: key, env: [] };
  const prefix = key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return {
    apiKey: process.env[`${prefix}_API_KEY`] || null,
    baseUrl: process.env[`${prefix}_API_BASE_URL`] || cfg.defaultBaseUrl || null,
    webhookSecret: process.env[`${prefix}_WEBHOOK_SECRET`] || null,
    configured: Boolean(process.env[`${prefix}_API_KEY`]),
    requiredEnv: cfg.env || [`${prefix}_API_KEY`, `${prefix}_API_BASE_URL`, `${prefix}_WEBHOOK_SECRET`],
  };
}

export function providerClient(providerKey) {
  const env = getProviderEnv(providerKey);
  if (!env.apiKey) {
    const err = new Error(`${providerKey} credentials are not configured. Add ${getProviderEnv(providerKey).requiredEnv.join(", ")} to production environment.`);
    err.code = "VPP_PROVIDER_NOT_CONFIGURED";
    throw err;
  }
  return axios.create({
    baseURL: env.baseUrl,
    timeout: 15000,
    headers: { Authorization: `Bearer ${env.apiKey}`, "Content-Type": "application/json" },
  });
}

export function computeRevenueSplit(grossAmount, { gridguideFeePct = 0.20, installerSharePct = 0 } = {}) {
  const gross = Number(grossAmount || 0);
  const installerAmount = Math.max(0, gross * Number(installerSharePct || 0));
  const gridguideAmount = Math.max(0, gross * Number(gridguideFeePct || 0));
  const homeownerAmount = Math.max(0, gross - gridguideAmount - installerAmount);
  return { grossAmount: gross, homeownerAmount, gridguideAmount, installerAmount };
}

export async function routeVppProgram({ prisma, userId, state, utility, deviceTypes = [] }) {
  const normalizedState = state?.toUpperCase();
  const devices = deviceTypes.map(String);
  const programs = await prisma.vppGridProgram.findMany({
    where: {
      status: { in: ["ACTIVE", "WAITLIST"] },
      ...(normalizedState ? { OR: [{ state: normalizedState }, { state: null }] } : {}),
      ...(utility ? { OR: [{ utility }, { utility: null }] } : {}),
    },
    include: { provider: true },
    orderBy: [{ state: "desc" }, { utility: "desc" }, { createdAt: "asc" }],
  });

  const eligible = programs.filter((p) => {
    if (!p.deviceTypes?.length) return true;
    return p.deviceTypes.some((d) => devices.includes(d));
  });

  const activeEnrollment = await prisma.vppProgramEnrollment.findFirst({
    where: { userId, status: { in: ["PENDING_PROVIDER", "ACTIVE"] } },
    include: { program: true, provider: true },
  });

  return {
    eligible,
    recommended: eligible[0] || null,
    activeEnrollment,
    conflict: activeEnrollment ? "User already has an active or pending VPP enrollment. Conflicting duplicate enrollment is blocked." : null,
  };
}

export async function sendPartnerEnrollment(providerKey, enrollmentPayload) {
  const client = providerClient(providerKey);
  // Provider-specific payloads vary. GridGuide stores the local enrollment first,
  // then maps this neutral payload to Leap/Enel once partner contract docs are available.
  const res = await client.post("/v1/enrollments", enrollmentPayload);
  return res.data;
}

export async function sendPartnerEventAck(providerKey, externalEventId, payload = {}) {
  const client = providerClient(providerKey);
  const res = await client.post(`/v1/events/${encodeURIComponent(externalEventId)}/ack`, payload);
  return res.data;
}
