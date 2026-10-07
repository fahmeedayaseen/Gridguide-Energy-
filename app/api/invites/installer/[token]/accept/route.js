/**
 * POST /api/invites/installer/[token]/accept
 * Body (new user):      { name, password }
 * Body (existing user): {} — must already be authenticated as the invited email
 *
 * On success:
 *   1. Creates or verifies the user account
 *   2. Creates an unverified InstallerReferral (pending homeowner confirmation)
 *   3. Marks the invite SIGNED_UP
 *   4. Updates campaign signupCount
 *   5. Issues session tokens for new accounts
 */
import { prisma }            from "@/lib/db.js";
import { ok, err, parseBody, hashPassword, setTokenCookies } from "@/lib/auth.js";
import { authenticateRequest, issueTokens } from "@/lib/jwt.js";
import { z }                 from "zod";

const acceptSchema = z.object({
  name:     z.string().min(1).max(150).optional(),
  password: z.string().min(8).max(100).optional(),
});

export async function POST(request, { params }) {
  const invite = await prisma.installerCustomerInvite.findUnique({
    where: { inviteToken: params.token },
    include: { installer: { select: { id: true, companyName: true, referralCode: true } } },
  });

  if (!invite) return err("Invitation not found.", 404);
  if (["SIGNED_UP","SUBSCRIBED","DECLINED"].includes(invite.status)) {
    return err("This invitation has already been used.", 409);
  }

  const { data, error } = await parseBody(request, acceptSchema);
  if (error) return err("Validation failed", 400, error);

  let user = await prisma.user.findUnique({ where: { email: invite.email } });
  let response;

  if (user) {
    // Must be authenticated as this exact email
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
        name:  data.name,
        email: invite.email,
        passwordHash,
        role:  "CONSUMER",
        plan:  "HOMEOWNER_FREE",
        personalReferralCode: `GGH-${Date.now().toString(36).toUpperCase()}`,
        rewards: { create: { points: 0, tier: "Bronze" } },
      },
    });
    const tokens = issueTokens(user);
    response = setTokenCookies(
      ok({ message: "Account created. Welcome to GridGuide!", accountCreated: true,
           user: { id: user.id, name: user.name, email: user.email } }, 201),
      tokens
    );
  }

  // Create unverified InstallerReferral — needs homeowner confirmation or admin approval
  const existingReferral = await prisma.installerReferral.findUnique({
    where: { installerId_userId: { installerId: invite.installer.id, userId: user.id } },
  }).catch(() => null);

  if (!existingReferral) {
    await prisma.installerReferral.create({
      data: {
        installerId:   invite.installer.id,
        userId:        user.id,
        referralCode:  invite.installer.referralCode || "",
        sourceType:    "invite",
        userPlan:      "HOMEOWNER_FREE",
        conversionStatus: "referred",
        verified:      false, // homeowner must confirm or admin must approve
      },
    }).catch(() => {});
  }

  // Mark invite SIGNED_UP
  await prisma.installerCustomerInvite.update({
    where: { id: invite.id },
    data: {
      status:          "SIGNED_UP",
      signedUpAt:      new Date(),
      convertedUserId: user.id,
    },
  });

  // Notify installer
  await prisma.notification.create({
    data: {
      userId:  invite.installer.userId || invite.installer.id,
      type:    "REFERRAL_SIGNED_UP",
      title:   "Invitation accepted",
      message: `${user.name || invite.email} accepted your GridGuide invitation.`,
      data:    { inviteId: invite.id, userId: user.id },
    },
  }).catch(() => {});

  // Update campaign signupCount
  if (invite.campaignId) {
    await prisma.installerCampaign.update({
      where: { id: invite.campaignId },
      data:  { signupCount: { increment: 1 } },
    }).catch(() => {});
  }

  return response;
}
