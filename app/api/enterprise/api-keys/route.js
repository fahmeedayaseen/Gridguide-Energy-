/**
 * GET  /api/enterprise/api-keys — list keys (prefix only, never the full key)
 * POST /api/enterprise/api-keys — create a key. The full key is returned
 *                                  exactly once, in this response, and never
 *                                  again — only its hash is stored.
 *
 * Gated on EnterpriseOrg.apiEnabled (a plan-gated feature). Uses
 * EnterpriseApiKey, a model that already existed from the original
 * Enterprise Portal migration but had no route built against it until now.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseAdmin } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const createSchema = z.object({ label: z.string().min(1).max(100) });

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const keys = await prisma.enterpriseApiKey.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  });
  return ok({ keys, apiEnabled: org.apiEnabled });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;
  if (!org.apiEnabled) return err("API access is not enabled on your plan. Upgrade to Enterprise to use the API.", 403);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const rawKey = `gg_live_${crypto.randomBytes(24).toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 16);

  const key = await prisma.enterpriseApiKey.create({
    data: { orgId: org.id, label: data.label, keyPrefix, keyHash },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "API_KEY_CREATED",
    targetType: "EnterpriseApiKey", targetId: key.id, orgId: org.id,
    category: "OTHER", metadata: { label: key.label },
  });

  return ok({
    key: { id: key.id, label: key.label, keyPrefix: key.keyPrefix, createdAt: key.createdAt },
    rawKey, // shown once — the frontend must display this prominently and warn it won't be shown again
    message: "API key created. Copy it now — it won't be shown again.",
  }, 201);
}
