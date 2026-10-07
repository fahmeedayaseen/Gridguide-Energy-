/**
 * DELETE /api/enterprise/api-keys/[id] — revoke a key (soft: sets revokedAt,
 * doesn't delete the row, so revocation is auditable).
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseAdmin } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";

export async function DELETE(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseAdmin(auth.user.id);
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const key = await prisma.enterpriseApiKey.findUnique({ where: { id: params.id } });
  if (!key || key.orgId !== org.id) return err("API key not found", 404);

  const updated = await prisma.enterpriseApiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "API_KEY_REVOKED",
    targetType: "EnterpriseApiKey", targetId: key.id, orgId: org.id,
    category: "OTHER", metadata: { label: key.label },
  });

  return ok({ key: updated, message: "API key revoked." });
}
