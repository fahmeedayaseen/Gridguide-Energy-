/**
 * Optional production-safe VPP provider seed.
 * Creates provider metadata only. It does NOT create fake homeowners, enrollments,
 * events, payouts, or earnings.
 * Run after DATABASE_URL is configured:
 *   node prisma/seed-vpp-providers.js
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const providers = [
  { key: "leap", name: "Leap", status: "PENDING_CREDENTIALS", notes: "Add LEAP_API_KEY, LEAP_API_BASE_URL, and LEAP_WEBHOOK_SECRET before live dispatch." },
  { key: "enel", name: "Enel X / Enel Grid Services", status: "PENDING_CREDENTIALS", notes: "Add ENEL_API_KEY, ENEL_API_BASE_URL, and ENEL_WEBHOOK_SECRET before live dispatch." },
];

async function main() {
  for (const provider of providers) {
    // create-only: re-running must not reset a live provider back to PENDING_CREDENTIALS.
    await prisma.vppProvider.upsert({ where: { key: provider.key }, update: {}, create: provider });
  }
  console.log("VPP provider metadata seeded safely.");
}

main().finally(() => prisma.$disconnect());
