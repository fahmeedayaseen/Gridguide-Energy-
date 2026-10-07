import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { createConnectedAccount, createAccountLink } from "@/lib/stripe.js";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

// POST /api/payments/connect — start Stripe Connect onboarding
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  if (!["SELLER","INSTALLER"].includes(auth.user.role)) {
    return err("Only sellers and installers can connect a Stripe account.", 403);
  }

  const isSeller    = auth.user.role === "SELLER";
  const record      = isSeller
    ? await prisma.seller.findUnique({ where: { userId: auth.user.id } })
    : await prisma.installer.findUnique({ where: { userId: auth.user.id } });

  if (!record) return err("Account not found. Complete registration first.", 404);

  let stripeAccountId = record.stripeAccountId;

  // Create Stripe Express account if none exists
  if (!stripeAccountId) {
    const account     = await createConnectedAccount({ email: auth.user.email });
    stripeAccountId   = account.id;

    if (isSeller) {
      await prisma.seller.update({ where: { userId: auth.user.id }, data: { stripeAccountId } });
    } else {
      await prisma.installer.update({ where: { userId: auth.user.id }, data: { stripeAccountId } });
    }
  }

  // Generate onboarding link (expires in ~5 min)
  const portalPath = isSeller ? "/portals/seller" : "/portals/installer";
  const link     = await createAccountLink(stripeAccountId, {
    refreshUrl: `${BASE}${portalPath}?tab=payouts&refresh=1`,
    returnUrl:  `${BASE}${portalPath}?tab=payouts&connected=1`,
  });

  return ok({ url: link.url, stripeAccountId });
}

// GET /api/payments/connect — get Stripe Connect status
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const isSeller = auth.user.role === "SELLER";
  const record   = isSeller
    ? await prisma.seller.findUnique({ where: { userId: auth.user.id }, select: { stripeAccountId: true } })
    : await prisma.installer.findUnique({ where: { userId: auth.user.id }, select: { stripeAccountId: true } });

  return ok({
    connected: !!(record?.stripeAccountId),
    stripeAccountId: record?.stripeAccountId || null,
  });
}
