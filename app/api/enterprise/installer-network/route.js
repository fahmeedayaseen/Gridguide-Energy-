/**
 * POST /api/enterprise/installer-network — enterprise admin invites an
 * installer into their network. State machine:
 *   INVITED -> INSTALLER_ACCEPTED -> ADMIN_APPROVED (active)
 *           -> INSTALLER_DECLINED / ADMIN_REJECTED / REMOVED
 * Installer consent is required before admin can approve - confirmed
 * decision, matches the consent-first precedent from device linking.
 * GET  /api/enterprise/installer-network — list for the org's tracking view.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const inviteSchema = z.object({ installerId: z.string() });

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);

  const network = await prisma.enterpriseInstallerNetwork.findMany({
    where: { orgId: access.org.id },
    orderBy: { invitedAt: "desc" },
    include: { installer: { select: { companyName: true } } },
  });
  return ok({ network });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Admin");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const { data, error } = await parseBody(request, inviteSchema);
  if (error) return err("Validation failed", 400, error);

  const installer = await prisma.installer.findUnique({ where: { id: data.installerId } });
  if (!installer) return err("Installer not found.", 404);

  const existing = await prisma.enterpriseInstallerNetwork.findUnique({
    where: { orgId_installerId: { orgId: org.id, installerId: data.installerId } },
  });
  if (existing && !["INSTALLER_DECLINED", "ADMIN_REJECTED", "REMOVED"].includes(existing.status)) {
    return err("A network relationship with this installer already exists or is pending.", 409);
  }

  const network = existing
    ? await prisma.enterpriseInstallerNetwork.update({ where: { id: existing.id }, data: { status: "INVITED", invitedAt: new Date(), installerRespondedAt: null, adminApprovedByUserId: null, adminApprovedAt: null } })
    : await prisma.enterpriseInstallerNetwork.create({ data: { orgId: org.id, installerId: data.installerId } });

  await prisma.notification.create({
    data: {
      userId: installer.userId, type: "ENTERPRISE_NETWORK_INVITE", title: "Enterprise network invitation",
      message: `${org.name} has invited you to join their installer network.`,
      data: { networkId: network.id, orgName: org.name },
    },
  }).catch(() => {});

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "INSTALLER_NETWORK_INVITE_SENT",
    targetType: "EnterpriseInstallerNetwork", targetId: network.id, orgId: org.id,
    category: "ASSIGNMENT", metadata: { installerId: data.installerId },
  });

  return ok({ network, message: `Invitation sent to ${installer.companyName}.` }, 201);
}
