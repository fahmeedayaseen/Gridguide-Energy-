/**
 * POST /api/admin/enterprise-requests/[id]/approve
 *
 * Closes a real gap: the Enterprise Portal looks up its data by
 * EnterpriseOrg.ownerUserId, but nothing anywhere created an EnterpriseOrg
 * row — POST /api/enterprise/request-access only ever logged a sales lead.
 * This is the actual provisioning step: an admin reviews a pending
 * EnterpriseRequest and this creates the real EnterpriseOrg (and, if
 * needed, the owning User account) from it.
 *
 * If a User already exists with the request's email, that user becomes
 * the org owner (their existing password/session is untouched). If not,
 * a new User is created with role ENTERPRISE and a random unusable
 * placeholder password — they're emailed a real setup link using the same
 * Redis token mechanism as the password-reset flow to set their own
 * password before they can log in.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db.js";
import { ok, err, hashPassword } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { redis } from "@/lib/redis.js";
import { v4 as uuid } from "uuid";
import { sendEnterpriseAccountProvisioned } from "@/lib/email.js";

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const enterpriseRequest = await prisma.enterpriseRequest.findUnique({ where: { id: params.id } });
  if (!enterpriseRequest) return err("Request not found", 404);
  if (enterpriseRequest.status === "approved") return err("This request has already been approved.", 409);

  // Reuse an existing account if one matches this email — never overwrite
  // an existing password. Otherwise create a new ENTERPRISE-role user.
  let user = await prisma.user.findUnique({ where: { email: enterpriseRequest.email } });
  let isNewUser = false;

  if (user) {
    // An account already exists — if it's not already an enterprise user,
    // promote it. (A homeowner submitting the request with their existing
    // account is a normal, expected case.)
    if (user.role !== "ENTERPRISE") {
      user = await prisma.user.update({ where: { id: user.id }, data: { role: "ENTERPRISE" } });
    }
  } else {
    isNewUser = true;
    const placeholderPasswordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
    user = await prisma.user.create({
      data: {
        name: enterpriseRequest.contactName,
        email: enterpriseRequest.email,
        phone: enterpriseRequest.phone || undefined,
        passwordHash: placeholderPasswordHash,
        role: "ENTERPRISE",
        emailVerified: false,
      },
    });
  }

  // Prevent double-provisioning if this user already owns an org.
  const existingOrg = await prisma.enterpriseOrg.findUnique({ where: { ownerUserId: user.id } });
  if (existingOrg) return err("This user already owns an Enterprise organization.", 409);

  const org = await prisma.enterpriseOrg.create({
    data: {
      name: enterpriseRequest.orgName,
      contactName: enterpriseRequest.contactName,
      contactEmail: enterpriseRequest.email,
      contactPhone: enterpriseRequest.phone || null,
      ownerUserId: user.id,
      plan: "ENTERPRISE_BASIC",
    },
  });

  await prisma.enterpriseRequest.update({
    where: { id: enterpriseRequest.id },
    data: { status: "approved", reviewedAt: new Date(), reviewedBy: auth.user.id },
  });

  await prisma.enterpriseAuditLog.create({
    data: { orgId: org.id, userId: auth.user.id, action: "ORG_PROVISIONED", metadata: { fromRequestId: enterpriseRequest.id, isNewUser } },
  }).catch(() => {});

  // New users need a real setup link; existing users already have a
  // password and can just log in with their org now active.
  if (isNewUser) {
    const token = uuid();
    await redis.setEx(`pwd-reset:${token}`, 3600, user.id);
    await sendEnterpriseAccountProvisioned(user, org, token).catch((e) => console.error("[Enterprise Provisioning] Email failed:", e.message));
  }

  return ok({
    org, isNewUser,
    message: isNewUser
      ? `Organization created. A setup email was sent to ${user.email}.`
      : `Organization created and linked to the existing account for ${user.email}.`,
  }, 201);
}
