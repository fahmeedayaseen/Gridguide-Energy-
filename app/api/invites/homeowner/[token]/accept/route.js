/**
 * POST /api/invites/homeowner/[token]/accept
 * body: {} if the requester is already logged in as the invited email, or
 *       {name, password} if no account exists yet and one needs creating.
 *
 * If an account already exists but the requester isn't authenticated as
 * that exact email, this returns an error asking them to log in first -
 * never silently attaches the org relationship to the wrong account.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody, hashPassword, setTokenCookies } from "@/lib/auth.js";
import { authenticateRequest, issueTokens } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const acceptSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  password: z.string().min(8).max(100).optional(),
});

export async function POST(request, { params }) {
  const invite = await prisma.enterpriseHomeownerInvite.findUnique({
    where: { token: params.token },
    include: { org: { select: { id: true, name: true } } },
  });
  if (!invite) return err("Invitation not found.", 404);
  if (invite.status !== "PENDING") return err(`This invitation has already been ${invite.status.toLowerCase()}.`, 409);
  if (invite.expiresAt < new Date()) return err("This invitation has expired.", 410);

  const { data, error } = await parseBody(request, acceptSchema);
  if (error) return err("Validation failed", 400, error);

  let user = await prisma.user.findUnique({ where: { email: invite.email } });
  let response;

  if (user) {
    // Account exists - the acceptor must already be authenticated as
    // exactly this email. Never attach the relationship to a different
    // logged-in account, and never silently log someone in as this user.
    const auth = await authenticateRequest(request);
    if (auth.error || auth.user.email !== invite.email) {
      return err("An account with this email already exists. Please log in as that account, then open this invitation link again.", 401);
    }
    response = ok({ message: "Invitation accepted.", accountCreated: false });
  } else {
    if (!data.name || !data.password) {
      return err("Name and password are required to create your account.", 400);
    }
    const passwordHash = await hashPassword(data.password);
    user = await prisma.user.create({
      data: {
        name: data.name, email: invite.email, passwordHash,
        role: "CONSUMER", plan: "HOMEOWNER_FREE",
        personalReferralCode: `GGH-${Date.now().toString(36).toUpperCase()}`,
        rewards: { create: { points: 0, tier: "Bronze" } },
      },
    });
    const tokens = issueTokens(user);
    response = setTokenCookies(ok({ message: "Account created and invitation accepted.", accountCreated: true, user: { id: user.id, name: user.name, email: user.email } }, 201), tokens);
  }

  await prisma.enterpriseHomeownerInvite.update({
    where: { id: invite.id },
    data: { status: "ACCEPTED", homeownerUserId: user.id, respondedAt: new Date() },
  });

  if (invite.invitedViaInstallerId) {
    const alreadyReferred = await prisma.installerReferral.findFirst({ where: { userId: user.id, installerId: invite.invitedViaInstallerId } });
    if (!alreadyReferred) {
      await prisma.installerReferral.create({
        data: {
          installerId: invite.invitedViaInstallerId, userId: user.id,
          referralCode: `ENT-${invite.org.id.slice(-6).toUpperCase()}`,
          sourceType: "signup", conversionStatus: "referred", userPlan: user.plan,
          // Real proof: this org specifically invited this homeowner, the
          // installer is ADMIN_APPROVED in that org's network (platform-
          // vetted), and the homeowner just affirmatively accepted - a
          // stronger chain of verification than the standard signup-code
          // path, which is already auto-verified.
          verified: true, verifiedAt: new Date(),
        },
      }).catch((e) => console.error("[Homeowner Invite] InstallerReferral creation failed:", e.message));
    }
  }

  await logAudit({
    actorUserId: user.id, actorRole: "CONSUMER", action: "HOMEOWNER_INVITE_ACCEPTED",
    targetType: "EnterpriseHomeownerInvite", targetId: invite.id, orgId: invite.org.id,
    category: "ASSIGNMENT", metadata: { email: invite.email },
  });

  return response;
}
