/**
 * GET  /api/installers/network-invites — pending enterprise network invites
 *      for the current installer.
 * POST /api/installers/network-invites/[id]/respond — installer accepts
 *      or declines. Acceptance moves status to INSTALLER_ACCEPTED, still
 *      requiring a platform admin's final approval before it's active.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const respondSchema = z.object({ action: z.enum(["accept", "decline"]) });

export async function POST(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const network = await prisma.enterpriseInstallerNetwork.findUnique({ where: { id: params.id }, include: { org: { select: { name: true } } } });
  if (!network || network.installerId !== installer.id) return err("Invitation not found.", 404);
  if (network.status !== "INVITED") return err("This invitation has already been responded to.", 409);

  const { data, error } = await parseBody(request, respondSchema);
  if (error) return err("Validation failed", 400, error);

  const newStatus = data.action === "accept" ? "INSTALLER_ACCEPTED" : "INSTALLER_DECLINED";
  const updated = await prisma.enterpriseInstallerNetwork.update({
    where: { id: network.id },
    data: { status: newStatus, installerRespondedAt: new Date() },
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: "INSTALLER", action: `INSTALLER_NETWORK_${newStatus}`,
    targetType: "EnterpriseInstallerNetwork", targetId: network.id, orgId: network.orgId,
    category: "ASSIGNMENT", metadata: { installerId: installer.id },
  });

  return ok({
    network: updated,
    message: data.action === "accept"
      ? `Accepted — pending final approval from GridGuide.`
      : `Declined invitation from ${network.org.name}.`,
  });
}
