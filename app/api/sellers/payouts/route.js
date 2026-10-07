/**
 * GET /api/sellers/payouts — the authenticated seller's own payout history.
 *
 * The only existing payout endpoint (GET /api/payments/payouts) is
 * admin-only — it's the platform-wide queue for triggering transfers, not
 * something a seller can call to see their own earnings. This is the
 * self-service equivalent, matching the pattern GET /api/installers/commissions
 * already establishes for installers.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found.", 404);

  const { searchParams } = new URL(request.url);
  const page  = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") || "25"));

  const [payouts, total, pendingAgg, paidAgg, nextScheduled] = await Promise.all([
    prisma.sellerPayout.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit, take: limit,
      include: { order: { select: { id: true, items: { select: { quantity: true } } } } },
    }),
    prisma.sellerPayout.count({ where: { sellerId: seller.id } }),
    prisma.sellerPayout.aggregate({ where: { sellerId: seller.id, status: "PENDING" }, _sum: { netAmount: true } }),
    prisma.sellerPayout.aggregate({ where: { sellerId: seller.id, status: "PAID" }, _sum: { netAmount: true } }),
    prisma.sellerPayout.findFirst({
      where: { sellerId: seller.id, status: "PENDING" },
      orderBy: { scheduledFor: "asc" },
      select: { scheduledFor: true },
    }),
  ]);

  return ok({
    payouts, total, page, pages: Math.ceil(total / limit),
    summary: {
      totalEarned:    paidAgg._sum.netAmount || 0,
      pendingPayout:  pendingAgg._sum.netAmount || 0,
      nextPayoutDate: nextScheduled?.scheduledFor || null,
      hasStripeAccount: !!seller.stripeAccountId,
    },
  });
}
