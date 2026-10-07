/**
 * Homeowner referral link API
 * GET /api/referrals/link — returns the logged-in homeowner/user's share link.
 * POST /api/referrals/link — rotates the logged-in user's share code.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai").replace(/\/$/, "");
const makeCode = (userId) => `GGH-${userId.slice(-6).toUpperCase()}`;
const makeRandomCode = () => `GGH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

async function ensureCode(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, personalReferralCode: true, name: true, email: true },
  });
  if (!user) return null;
  if (user.personalReferralCode) return user;

  let code = makeCode(user.id);
  const existing = await prisma.user.findUnique({ where: { personalReferralCode: code }, select: { id: true } }).catch(() => null);
  if (existing) code = makeRandomCode();

  return prisma.user.update({
    where: { id: user.id },
    data: { personalReferralCode: code },
    select: { id: true, personalReferralCode: true, name: true, email: true },
  });
}

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const user = await ensureCode(auth.user.id);
  if (!user) return err("User not found", 404);

  const code = user.personalReferralCode;
  const referralUrl = `${BASE_URL}/signup?ref=${encodeURIComponent(code)}`;
  return ok({
    referralCode: code,
    referralUrl,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(referralUrl)}`,
    shareText: `Join GridGuide with my referral link and start earning from your home energy: ${referralUrl}`,
  });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  let code = makeRandomCode();
  for (let i = 0; i < 5; i += 1) {
    const existing = await prisma.user.findUnique({ where: { personalReferralCode: code }, select: { id: true } }).catch(() => null);
    if (!existing) break;
    code = makeRandomCode();
  }

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { personalReferralCode: code },
    select: { personalReferralCode: true },
  });

  const referralUrl = `${BASE_URL}/signup?ref=${encodeURIComponent(user.personalReferralCode)}`;
  return ok({ referralCode: user.personalReferralCode, referralUrl });
}
