/**
 * GET /api/admin/payouts — read-only list of real seller and installer
 * payouts with totals. Replaces the hard-coded rows the admin Payouts tab
 * used to show. Payout execution stays in the existing cron jobs.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const raw    = searchParams.get("status");
  const status = ["PENDING", "PROCESSING", "PAID", "FAILED", "REFUNDED"].includes(raw) ? raw : undefined;
  const limit  = Math.min(200, parseInt(searchParams.get("limit") || "100"));
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [sellerPayouts, installerPayouts, sellerPending, installerPending, sellerPaidMonth, installerPaidMonth] = await Promise.all([
    prisma.sellerPayout.findMany({
      where: { ...(status && { status }) }, orderBy: { createdAt: "desc" }, take: limit,
      include: { seller: { select: { companyName: true } } },
    }),
    prisma.installerPayout.findMany({
      where: { ...(status && { status }) }, orderBy: { createdAt: "desc" }, take: limit,
      include: { installer: { select: { companyName: true } }, job: { select: { title: true } } },
    }),
    prisma.sellerPayout.aggregate({ where: { status: "PENDING" }, _sum: { netAmount: true } }),
    prisma.installerPayout.aggregate({ where: { status: "PENDING" }, _sum: { netAmount: true } }),
    prisma.sellerPayout.aggregate({ where: { status: "PAID", settledAt: { gte: monthStart } }, _sum: { netAmount: true, commission: true } }),
    prisma.installerPayout.aggregate({ where: { status: "PAID", settledAt: { gte: monthStart } }, _sum: { netAmount: true, successFee: true } }),
  ]);

  const payouts = [
    ...sellerPayouts.map((p) => ({
      id: p.id, type: "SELLER", payee: p.seller?.companyName || "Seller", reference: `Order ${p.orderId.slice(-8).toUpperCase()}`,
      gross: p.grossAmount, fee: p.commission + p.processingFee, net: p.netAmount, status: p.status,
      scheduledFor: p.scheduledFor, settledAt: p.settledAt, createdAt: p.createdAt,
    })),
    ...installerPayouts.map((p) => ({
      id: p.id, type: "INSTALLER", payee: p.installer?.companyName || "Installer", reference: p.job?.title || "Job",
      gross: p.projectValue, fee: p.successFee, net: p.netAmount, status: p.status,
      scheduledFor: p.scheduledFor, settledAt: p.settledAt, createdAt: p.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);

  return ok({
    payouts,
    totals: {
      pending:          (sellerPending._sum.netAmount || 0) + (installerPending._sum.netAmount || 0),
      paidThisMonth:    (sellerPaidMonth._sum.netAmount || 0) + (installerPaidMonth._sum.netAmount || 0),
      feesThisMonth:    (sellerPaidMonth._sum.commission || 0) + (installerPaidMonth._sum.successFee || 0),
    },
  });
}
