/**
 * POST /api/invites/team/[token]/accept — mirrors the homeowner invite
 * accept pattern. Creates an account if needed, or requires the acceptor
 * be logged in as exactly the invited email if one already exists.
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
  const member = await prisma.enterpriseTeamMember.findUnique({
    where: { inviteToken: params.token },
    include: { org: { select: { id: true, name: true } } },
  });
  if (!member) return err("Invitation not found.", 404);
  if (member.status !== "PENDING") return err("This invitation has already been resolved.", 409);
  if (member.inviteExpiresAt && member.inviteExpiresAt < new Date()) return err("This invitation has expired.", 410);

  const { data, error } = await parseBody(request, acceptSchema);
  if (error) return err("Validation failed", 400, error);

  let user = await prisma.user.findUnique({ where: { email: member.email } });
  let response;

  if (user) {
    const auth = await authenticateRequest(request);
    if (auth.error || auth.user.email !== member.email) {
      return err("An account with this email already exists. Please log in as that account, then open this invitation link again.", 401);
    }
    response = ok({ message: "Invitation accepted.", accountCreated: false });
  } else {
    if (!data.name || !data.password) return err("Name and password are required to create your account.", 400);
    const passwordHash = await hashPassword(data.password);
    user = await prisma.user.create({
      data: {
        name: data.name, email: member.email, passwordHash,
        role: "CONSUMER", plan: "HOMEOWNER_FREE",
        personalReferralCode: `GGT-${Date.now().toString(36).toUpperCase()}`,
        rewards: { create: { points: 0, tier: "Bronze" } },
      },
    });
    const tokens = issueTokens(user);
    response = setTokenCookies(ok({ message: "Account created and invitation accepted.", accountCreated: true, user: { id: user.id, name: user.name, email: user.email } }, 201), tokens);
  }

  await prisma.enterpriseTeamMember.update({
    where: { id: member.id },
    data: { status: "ACTIVE", userId: user.id, acceptedAt: new Date() },
  });

  await logAudit({
    actorUserId: user.id, actorRole: member.role, action: "TEAM_MEMBER_ACCEPTED",
    targetType: "EnterpriseTeamMember", targetId: member.id, orgId: member.org.id,
    category: "TEAM", metadata: { email: member.email, role: member.role },
  });

  return response;
}
