/**
 * POST /api/auth/register
 * Creates a new user account.
 *
 * Referral handling:
 *  - If referralCode starts with "GG-"  → installer referral (InstallerReferral)
 *  - If referralCode starts with "GGH-" → homeowner referral (HomeownerReferral)
 *    Only the relationship is recorded here (status: "signed_up"). The
 *    referrer's credit bonus (default 2,500 credits = $2.50, admin-adjustable
 *    via PlatformConfig) is awarded in app/api/payments/webhook/route.js
 *    once the referred homeowner's subscription actually activates on a
 *    paid plan - not at signup. Awarding it here regardless of whether the
 *    referred person ever paid was a real bug this fixed.
 *  - Both: notifies the referrer, increments their counters
 */
import { prisma }                from "@/lib/db.js";
import { hashPassword, parseBody, ok, err, setTokenCookies } from "@/lib/auth.js";
import { issueTokens }           from "@/lib/jwt.js";
import { rateLimit }             from "@/lib/redis.js";
import { stripe }                from "@/lib/stripe.js";
import { getPlatformConfig }     from "@/lib/platform-config.js";
import { ensureCreditAccount } from "@/lib/credits.js";
import { z }                     from "zod";

const schema = z.object({
  name:         z.string().min(1).max(100),
  email:        z.string().email(),
  password:     z.string().min(6).max(100),
  phone:        z.string().optional(),
  role:         z.enum(["CONSUMER","INSTALLER","SELLER"]).default("CONSUMER"),
  referralCode: z.string().optional(),
  signupSource: z.string().optional(),
  utmSource:    z.string().optional(),
  utmCampaign:  z.string().optional(),
});

export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`register:${ip}`, 5, 3600);
  if (!allowed) return err("Too many registration attempts. Try again later.", 429);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const { name, email, password, phone, role, referralCode, signupSource, utmSource, utmCampaign } = data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return err("An account with this email already exists.", 409);

  const cfg = await getPlatformConfig();

  // ── Resolve referral code ─────────────────────────────────────────────────
  const code = referralCode?.trim().toUpperCase() || null;
  let referringInstaller  = null;   // Installer that owns a GG-XXXXXX code
  let referringHomeowner  = null;   // Homeowner that owns a GGH-XXXXXX code

  if (code) {
    if (code.startsWith("GGH-")) {
      referringHomeowner = await prisma.user.findFirst({
        where:  { personalReferralCode: code },
        select: { id: true, name: true, email: true },
      });
    } else {
      referringInstaller = await prisma.installer.findFirst({
        where:  { referralCode: code },
        select: { id: true, userId: true, companyName: true, plan: true },
      });
    }
  }

  // ── Create Stripe customer ────────────────────────────────────────────────
  let stripeCustomerId;
  try {
    const customer = await stripe.customers.create({ name, email });
    stripeCustomerId = customer.id;
  } catch (e) {
    console.error("[Register] Stripe error:", e.message);
  }

  // ── Create user ───────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(password);
  const personalReferralCode = role === "CONSUMER"
    ? `GGH-${Date.now().toString(36).toUpperCase().slice(-6)}`
    : null;

  const user = await prisma.user.create({
    data: {
      name, email, passwordHash, phone, role,
      plan: "HOMEOWNER_FREE",
      stripeCustomerId,
      signupSource:         signupSource || "web",
      utmSource:            utmSource    || null,
      utmCampaign:          utmCampaign  || null,
      referralCode:         code,
      personalReferralCode,
      onboardingStep:       1,
      lastLoginAt:          new Date(),
      lastActiveAt:         new Date(),
      sessionCount:         1,
      rewards: { create: { points: 0, tier: "Bronze" } },
    },
    select: { id: true, name: true, email: true, role: true, plan: true, createdAt: true, personalReferralCode: true },
  });

  // Every consumer gets a CreditAccount immediately so the wallet UI works on day one
  if (role === "CONSUMER") {
    await ensureCreditAccount(user.id).catch(() => {});
  }

  // ── INSTALLER REFERRAL ────────────────────────────────────────────────────
  if (referringInstaller) {
    await prisma.installerReferral.create({
      data: {
        installerId:      referringInstaller.id,
        userId:           user.id,
        referralCode:     code,
        sourceType:       "signup",
        conversionStatus: "referred",
        userPlan:         "HOMEOWNER_FREE",
        monthlyRevenue:   0,
        installerShare:   0,
        lifetimeValue:    0,
        referredAt:       new Date(),
        verified:         true, // real proof: this homeowner used the installer's actual referral code at signup
        verifiedAt:       new Date(),
      },
    }).catch(e => console.error("[Register] InstallerReferral create failed:", e.message));

    await prisma.installer.update({
      where: { id: referringInstaller.id },
      data:  { totalReferredUsers: { increment: 1 } },
    }).catch(() => {});

    await prisma.notification.create({
      data: {
        userId:  referringInstaller.userId,
        type:    "NEW_REFERRAL",
        title:   `New Referral: ${name}`,
        message: `${name} just signed up using your referral code ${code}. They appear as "Referred (Pending)" in your Referrals tab.`,
      },
    }).catch(() => {});
  }

  // ── HOMEOWNER REFERRAL (credit-based, awarded on subscription activation,
  //    not at signup) ────────────────────────────────────────────────────
  let homeownerReferral = null;
  if (referringHomeowner) {
    homeownerReferral = await prisma.homeownerReferral.create({
      data: {
        referrerId:     referringHomeowner.id,
        referredUserId: user.id,
        referralCode:   code,
        status:         "signed_up",
        creditsAwarded: cfg.homeownerReferralCredits,
      },
    }).catch(e => { console.error("[Register] HomeownerReferral create failed:", e.message); return null; });

    if (homeownerReferral) {
      // Credits are NOT awarded here. They're awarded in
      // app/api/payments/webhook/route.js once this referred homeowner's
      // subscription actually goes active on a paid plan - "signed up"
      // is not "activates/pays", and awarding here regardless of whether
      // they ever convert was the bug this fixed.
      await prisma.notification.create({
        data: {
          userId:  referringHomeowner.id,
          type:    "REFERRAL_SIGNUP",
          title:   `${name} joined GridGuide!`,
          message: `Your friend ${name} signed up using your referral link. You'll earn ${cfg.homeownerReferralCredits.toLocaleString()} credits ($${(cfg.homeownerReferralCredits / cfg.creditsPerDollar).toFixed(2)}) once they activate a paid plan.`,
        },
      }).catch(() => {});
    }
  }

  const tokens = issueTokens(user);
  const response = ok({
    user,
    referralApplied:    !!(referringInstaller || referringHomeowner),
    referralType:       referringInstaller ? "installer" : referringHomeowner ? "homeowner" : null,
    referringInstaller: referringInstaller ? { company: referringInstaller.companyName } : null,
    referringHomeowner: referringHomeowner ? { name: referringHomeowner.name } : null,
    message: "Account created successfully.",
  }, 201);

  return setTokenCookies(response, tokens);
}
