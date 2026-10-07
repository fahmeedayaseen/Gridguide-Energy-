/**
 * POST /api/enterprise/homeowner-invites — enterprise admin invites a
 * homeowner by email. Rate-limited per org (same pattern as
 * forgot-password) since invitation-driven account creation could
 * otherwise be used to email-bomb an address.
 * GET  /api/enterprise/homeowner-invites — list for the org's tracking view.
 *
 * installerId (optional): attributes the invite to an installer in the
 * org's network. Phase 4 retrofit - validates the installer actually has
 * an ADMIN_APPROVED relationship with this org before accepting the
 * attribution, so this can't be used to claim an unapproved or
 * nonexistent relationship.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";
import { rateLimit } from "@/lib/redis.js";
// sendHomeownerInvite removed — single invites now queued
// import { sendHomeownerInvite } from "@/lib/email.js";
import { logAudit } from "@/lib/audit.js";
import { v4 as uuid } from "uuid";
import { z } from "zod";

const inviteSchema = z.object({ email: z.string().email(), installerId: z.string().optional() });

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const invites = await prisma.enterpriseHomeownerInvite.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
  });
  return ok({ invites });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Manager");
  if (!access.allowed) return err(access.error, access.status);
  const org = access.org;

  const { allowed } = await rateLimit(`enterprise-invite:${org.id}`, 20, 3600);
  if (!allowed) return err("Too many invitations sent. Try again in an hour.", 429);

  const { data, error } = await parseBody(request, inviteSchema);
  if (error) return err("Validation failed", 400, error);

  const existing = await prisma.enterpriseHomeownerInvite.findFirst({
    where: { orgId: org.id, email: data.email, status: "PENDING" },
  });
  if (existing) return err("An invitation to this email is already pending.", 409);

  let invitedViaInstallerId = null;
  if (data.installerId) {
    const approved = await prisma.enterpriseInstallerNetwork.findUnique({
      where: { orgId_installerId: { orgId: org.id, installerId: data.installerId } },
    });
    if (!approved || approved.status !== "ADMIN_APPROVED") {
      return err("This installer is not an approved member of your network.", 400);
    }
    invitedViaInstallerId = data.installerId;
  }

  const token = uuid();
  // P0 fix: create invite and delivery job atomically — no orphan invites
  const invite = await prisma.$transaction(async tx => {
    const created = await tx.enterpriseHomeownerInvite.create({
      data: {
        orgId: org.id, email: data.email, invitedByUserId: auth.user.id, invitedViaInstallerId,
        token, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await tx.invitationDeliveryJob.create({
      data: {
        invitationType: "ENTERPRISE_HOMEOWNER",
        invitationId:   created.id,
        campaignId:     created.campaignId ?? null, // nullable — standalone invite has no campaign
        recipientEmail: created.email,
        status:         "PENDING",
        availableAt:    new Date(),
      },
    });
    return created;
  });

  await logAudit({
    actorUserId: auth.user.id, actorRole: access.role, action: "HOMEOWNER_INVITE_SENT",
    targetType: "EnterpriseHomeownerInvite", targetId: invite.id, orgId: org.id,
    category: "ASSIGNMENT", metadata: { email: data.email },
  });

  return ok({ invite, message: `Invitation sent to ${data.email}.` }, 201);
}
