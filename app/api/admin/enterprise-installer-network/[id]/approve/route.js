/**
 * POST /api/admin/enterprise-installer-network/[id]/approve — final
 * platform-admin approval, only reachable once the installer has already
 * consented (status === INSTALLER_ACCEPTED). Also supports rejection.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const network = await prisma.enterpriseInstallerNetwork.findUnique({ where: { id: params.id } });
  if (!network) return err("Network relationship not found.", 404);
  if (network.status !== "INSTALLER_ACCEPTED") {
    return err("This relationship must be accepted by the installer before it can be approved.", 409);
  }

  const { data, error } = await parseBody(request, decisionSchema);
  if (error) return err("Validation failed", 400, error);

  const newStatus = data.decision === "approve" ? "ADMIN_APPROVED" : "ADMIN_REJECTED";
  const updated = await prisma.enterpriseInstallerNetwork.update({
    where: { id: network.id },
    data: { status: newStatus, adminApprovedByUserId: auth.user.id, adminApprovedAt: new Date() },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: "ADMIN", action: `INSTALLER_NETWORK_${newStatus}`,
    targetType: "EnterpriseInstallerNetwork", targetId: network.id, orgId: network.orgId,
    category: "ASSIGNMENT", metadata: { installerId: network.installerId },
  });

  return ok({ network: updated, message: `Relationship ${data.decision === "approve" ? "approved" : "rejected"}.` });
}
