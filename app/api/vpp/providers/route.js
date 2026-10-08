import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { getProviderEnv, VPP_PROVIDER_CONFIG, normalizeProviderKey } from "@/lib/vpp-partners.js";
import { z } from "zod";
import { isProviderPubliclyVisible, canProviderAcceptEnrollment, isEnergyHubEnabled } from "@/lib/vpp/provider-controls.js";

const providerSchema = z.object({
  key: z.string().min(2).transform(normalizeProviderKey),
  name: z.string().min(2),
  status: z.enum(["ACTIVE","SANDBOX","PENDING_CREDENTIALS","PAUSED","ERROR"]).optional(),
  publicVisible: z.boolean().optional(),
  enrollmentOpen: z.boolean().optional(),
  apiBaseUrl: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().optional(),
  metadata: z.any().optional(),
});

// Never send secret values to a browser. getProviderEnv() returns the raw
// API key and webhook secret; this endpoint used to include them verbatim
// for ANY signed-in user (homeowners included).
function safeEnv(key) {
  const { apiKey, webhookSecret, ...rest } = getProviderEnv(key);
  return { ...rest, hasApiKey: !!apiKey, hasWebhookSecret: !!webhookSecret };
}

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  // Non-admins get only providers they could actually see/enroll with.
  if (auth.user.role !== "ADMIN") {
    const providers = await prisma.vppProvider.findMany({ orderBy: { key: "asc" } });
    return ok({
      providers: providers.filter(isProviderPubliclyVisible).map(p => ({
        id: p.id, key: p.key, name: p.name, enrollmentOpen: canProviderAcceptEnrollment(p),
      })),
    });
  }

  const providers = await prisma.vppProvider.findMany({ orderBy: { key: "asc" }, include: { _count: { select: { programs: true, events: true, enrollments: true } } } });
  return ok({
    providers: providers.map(p => {
      const env = safeEnv(p.key);
      return { ...p, env, configured: env.configured, publiclyVisible: isProviderPubliclyVisible(p), acceptingEnrollment: canProviderAcceptEnrollment(p) };
    }),
    supported: VPP_PROVIDER_CONFIG,
    energyHubEnabled: isEnergyHubEnabled(),
  });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, providerSchema);
  if (error) return err("Validation failed", 400, error);
  const provider = await prisma.vppProvider.upsert({
    where: { key: data.key },
    update: { name: data.name, status: data.status || undefined, publicVisible: data.publicVisible, enrollmentOpen: data.enrollmentOpen, apiBaseUrl: data.apiBaseUrl, contactEmail: data.contactEmail, notes: data.notes, metadata: data.metadata },
    create: { key: data.key, name: data.name, status: data.status || "PENDING_CREDENTIALS", publicVisible: data.publicVisible ?? false, enrollmentOpen: data.enrollmentOpen ?? false, apiBaseUrl: data.apiBaseUrl, contactEmail: data.contactEmail, notes: data.notes, metadata: data.metadata },
  });
  return ok({ provider, message: `${provider.name} VPP provider saved.` }, 201);
}
