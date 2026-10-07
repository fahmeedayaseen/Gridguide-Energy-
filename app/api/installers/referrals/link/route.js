/**
 * GET  /api/installers/referrals/link  — get installer's referral link + QR
 * POST /api/installers/referrals/link  — regenerate installer's referral code
 */
import { prisma }             from "@/lib/db.js";
import { ok, err }            from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai").replace(/\/$/, "");

function makeInstallerCode(installerId) {
  return `GG-${installerId.slice(-6).toUpperCase()}`;
}

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({
    where:  { userId: auth.user.id },
    select: { id: true, referralCode: true, companyName: true, totalReferredUsers: true,
              monthlyReferralEarnings: true, plan: true },
  });
  if (!installer) return err("Installer profile not found", 404);

  // Auto-generate code if the installer doesn't have one
  let code = installer.referralCode;
  if (!code) {
    code = makeInstallerCode(installer.id);
    await prisma.installer.update({ where: { id: installer.id }, data: { referralCode: code } });
  }

  const referralUrl = `${BASE_URL}/signup?ref=${code}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(referralUrl)}`;

  const shareText = `Join GridGuide with my referral code ${code} and start earning from your home energy. `
    + `Sign up free: ${referralUrl}`;

  // Stats: total referrals in DB
  const stats = await prisma.installerReferral.groupBy({
    by: ["conversionStatus"],
    where: { installerId: installer.id },
    _count: true,
  }).catch(() => []);

  const statusMap = Object.fromEntries(stats.map(s => [s.conversionStatus, s._count]));

  return ok({
    referralCode: code,
    referralUrl,
    qrUrl,
    shareText,
    totalReferrals:     installer.totalReferredUsers || 0,
    monthlyEarnings:    installer.monthlyReferralEarnings || 0,
    pipeline: {
      referred:   statusMap["referred"]   || 0,
      activated:  statusMap["activated"]  || 0,
      subscribed: statusMap["subscribed"] || 0,
    },
  });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer profile not found", 404);

  const ts   = Date.now().toString(36).toUpperCase().slice(-4);
  const base = installer.id.slice(-4).toUpperCase();
  const newCode = `GG-${base}-${ts}`;

  await prisma.installer.update({ where: { id: installer.id }, data: { referralCode: newCode } });

  return ok({
    referralCode: newCode,
    referralUrl:  `${BASE_URL}/signup?ref=${newCode}`,
    message: "Referral code regenerated.",
  });
}
