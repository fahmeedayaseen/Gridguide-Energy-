/**
 * GridGuide — Development Seed (NOT for production)
 * Creates demo accounts for local testing only.
 *
 * Run: npm run db:seed:dev
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🧪 Seeding GridGuide DEV database (demo data)...\n");
  console.log("⚠️  This seed is for LOCAL DEVELOPMENT ONLY. Never run in production.\n");

  const hash = (p) => bcrypt.hash(p, 10);

  // Dev consumer
  const user = await prisma.user.upsert({
    where: { email: "alex@example.com" },
    update: {},
    create: {
      name: "Alex Rivera", email: "alex@example.com",
      passwordHash: await hash("demo123"),
      role: "CONSUMER", plan: "HOMEOWNER_PLUS", emailVerified: true,
      rewards: { create: { points: 0, tier: "Bronze" } },
    },
  });

  // Dev installer
  const installer = await prisma.user.upsert({
    where: { email: "hello@suntechsolutions.com" },
    update: {},
    create: {
      name: "Sam Stevens", email: "hello@suntechsolutions.com",
      passwordHash: await hash("install2026"),
      role: "INSTALLER", plan: "HOMEOWNER_PLUS", emailVerified: true,
      rewards: { create: { points: 0, tier: "Bronze" } },
    },
  });

  await prisma.installer.upsert({
    where: { userId: installer.id },
    update: {},
    create: {
      userId: installer.id,
      companyName: "SunTech Solutions",
      verificationStatus: "VERIFIED",
      plan: "PRO",
      successFeeRate: 0.05,
      revenueSharePct: 0.25,
      membershipMonthlyFee: 99,
      referralCode: "GG-ST4842",
    },
  });

  // Dev seller
  const seller = await prisma.user.upsert({
    where: { email: "seller@suntechproducts.com" },
    update: {},
    create: {
      name: "SunTech Products", email: "seller@suntechproducts.com",
      passwordHash: await hash("seller2026"),
      role: "SELLER", plan: "HOMEOWNER_PLUS", emailVerified: true,
      rewards: { create: { points: 0, tier: "Bronze" } },
    },
  });

  await prisma.seller.upsert({
    where: { userId: seller.id },
    update: {},
    create: {
      userId: seller.id,
      businessName: "SunTech Products LLC",
      verificationStatus: "VERIFIED",
      plan: "PRO",
      commissionRate: 0.07,
    },
  });

  // Admin
  await prisma.user.upsert({
    where: { email: "admin@gridguide.ai" },
    update: {},
    create: {
      name: "GridGuide Admin", email: "admin@gridguide.ai",
      passwordHash: await hash("admin2026"),
      role: "ADMIN", plan: "HOMEOWNER_PREMIUM", emailVerified: true,
      rewards: { create: { points: 0, tier: "Bronze" } },
    },
  });

  console.log("✅ Dev seed complete.\n");
  console.log("Dev credentials:");
  console.log("  Consumer:  alex@example.com / demo123");
  console.log("  Installer: hello@suntechsolutions.com / install2026");
  console.log("  Seller:    seller@suntechproducts.com / seller2026");
  console.log("  Admin:     admin@gridguide.ai / admin2026");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
