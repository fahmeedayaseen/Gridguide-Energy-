import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { getProviderEnv, VPP_PROVIDER_CONFIG, normalizeProviderKey } from "@/lib/vpp-partners.js";
import { z } from "zod";

const providerSchema = z.object({
  key: z.string().min(2).transform(normalizeProviderKey),
  name: z.string().min(2),
  status: z.enum(["ACTIVE","SANDBOX","PENDING_CREDENTIALS","PAUSED","ERROR"]).optional(),
  apiBaseUrl: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().optional(),
  metadata: z.any().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const providers = await prisma.vppProvider.findMany({ orderBy: { key: "asc" }, include: { _count: { select: { programs: true, events: true, enrollments: true } } } });
  return ok({ providers: providers.map(p => ({ ...p, env: getProviderEnv(p.key), configured: getProviderEnv(p.key).configured })), supported: VPP_PROVIDER_CONFIG });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, providerSchema);
  if (error) return err("Validation failed", 400, error);
  const provider = await prisma.vppProvider.upsert({
    where: { key: data.key },
    update: { name: data.name, status: data.status || undefined, apiBaseUrl: data.apiBaseUrl, contactEmail: data.contactEmail, notes: data.notes, metadata: data.metadata },
    create: { key: data.key, name: data.name, status: data.status || "PENDING_CREDENTIALS", apiBaseUrl: data.apiBaseUrl, contactEmail: data.contactEmail, notes: data.notes, metadata: data.metadata },
  });
  return ok({ provider, message: `${provider.name} VPP provider saved.` }, 201);
}
