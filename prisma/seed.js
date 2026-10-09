/**
 * GridGuide — Production Seed
 *
 * This seed creates ONLY the system admin account.
 * All other data (consumers, installers, sellers, products, jobs, etc.)
 * is created through the live application by real users.
 *
 * For local development with demo data, use:
 *   npm run db:seed:dev
 *
 * Run: npm run db:seed
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding GridGuide production database...\n");

  // ── System Admin ───────────────────────────────────────────────────────────
  // Production seed policy (Audit §9): no demo accounts, no fake data, and no
  // admin account with a password that's written in this repository.
  const IS_PROD = process.env.NODE_ENV === "production";
  const KNOWN_DEFAULT = "ChangeMe#2026!";
  const adminEmail    = (process.env.ADMIN_EMAIL || "admin@gridguide.ai").toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD || (IS_PROD ? null : KNOWN_DEFAULT);

  if (!adminPassword || (IS_PROD && (adminPassword === KNOWN_DEFAULT || adminPassword.length < 14))) {
    throw new Error(
      "Set ADMIN_PASSWORD (14+ characters, not the documented default) to seed the admin account in production."
    );
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  let admin;
  if (existingAdmin) {
    // Re-running the seed must never silently reset a live admin's password
    // (the old upsert did, back to the default). Opt in explicitly to rotate it.
    if (process.env.ADMIN_RESET_PASSWORD === "true") {
      admin = await prisma.user.update({
        where: { email: adminEmail },
        data:  { passwordHash: await bcrypt.hash(adminPassword, 12) },
      });
      console.log("  Admin password reset (ADMIN_RESET_PASSWORD=true).");
    } else {
      admin = existingAdmin;
      console.log("  Admin already exists — password left unchanged.");
    }
  } else {
    admin = await prisma.user.create({
      data: {
        name:          "GridGuide Admin",
        email:         adminEmail,
        passwordHash:  await bcrypt.hash(adminPassword, 12),
        role:          "ADMIN",
        plan:          "HOMEOWNER_PREMIUM",
        emailVerified: true,
        rewards: { create: { points: 0, tier: "Bronze" } },
      },
    });
  }
  console.log("✓ Admin account:", admin.email);
  if (!IS_PROD) console.log("  ⚠️  Development default password in use — never deploy this.\n");

  // ── Platform Config (singleton) ──────────────────────────────────────────
  // Seeds the admin-adjustable rates: installer revenue share, credit
  // economics (1,000 credits = $1), homeowner referral bonus (2,500 credits),
  // and the $2.50/mo redemption cap. All editable later from Admin → Rates.
  await prisma.platformConfig.upsert({
    where:  { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      installerShareFree:          0.15,
      installerSharePro:           0.25,
      installerShareEnterprise:    0.30,
      successFeeFree:              0.10,
      successFeePro:               0.07,
      successFeeEnterprise:        0.05,
      membershipFeeFree:           0,
      membershipFeePro:            99,
      membershipFeeEnterprise:     499,
      creditsPerDollar:            1000,
      homeownerReferralCredits:    2500,
      monthlyRedemptionCapCredits: 2500,
      monthlyRedemptionCapDollars: 2.50,
      homeownerSubscriptionPrice:  9.99,
      leadSuccessFeeFree:       0.10,
      leadSuccessFeePro:        0.07,
      leadSuccessFeeEnterprise: 0.05,
      gridFundDonationMinDollars:  1.00,
      gridFundDonationBonusPct:    0.10,
      vppSplitFreeHomeowner:        0.80,
      vppSplitFreeGridguide:        0.20,
      vppSplitFreeInstaller:        0.00,
      vppSplitProHomeowner:         0.75,
      vppSplitProGridguide:         0.20,
      vppSplitProInstaller:         0.05,
      vppSplitEnterpriseHomeowner:  0.75,
      vppSplitEnterpriseGridguide:  0.15,
      vppSplitEnterpriseInstaller:  0.10,
      sellerCommissionFree:        0.10,
      sellerCommissionPro:         0.08,
      marketplaceFee:              0.03,
      withdrawalFee:               0.00,
      publicDonationCounterEnabled: true,
      communityGoalLabel:           "Community Donation Goal",
      communityGoalTargetAmount:    100000,
      donationDisplayMode:          "lifetime",
    },
  });
  console.log("✓ Platform config seeded (rates, credit economics, redemption caps)\n");

  console.log("✅ Production seed complete.");
  console.log("\nNext steps:");
  console.log("  1. Log in at /admin-login and change your password");
  console.log("  2. Configure Stripe products and price IDs in .env");
  console.log("  3. Connect your utility data provider (UtilityAPI / DER-API)");
  console.log("  4. Verify SendGrid email templates are configured");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
