/**
 * GET   /api/enterprise/settings — org profile (Admin+ only, per the
 *       approved matrix - settings is explicitly excluded from Manager/Viewer)
 * PATCH /api/enterprise/settings — update org profile (Admin+)
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseAdmin } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const updateSchema = z.object({
  name:         z.string().min(1).max(150).optional(),
  contactName:  z.string().min(1).max(100).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
}).strict();

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  return ok({ org: access.org, yourRole: access.role });
}

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updated = await prisma.enterpriseOrg.update({ where: { id: org.id }, data });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "SETTINGS_UPDATED",
    targetType: "EnterpriseOrg", targetId: org.id, orgId: org.id,
    category: "OTHER", metadata: data,
  });

  return ok({ org: updated, message: "Settings saved." });
}
