import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { transferToSeller, transferToInstaller } from "@/lib/stripe.js";
import { sendSellerPayout } from "@/lib/email.js";
import { alertCritical, logger } from "@/lib/sentry.js";

// GET /api/payments/payouts — admin: pending payout queue
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "all"; // seller|installer|vpp|all

  const [sellerPayouts, installerPayouts, vppPayouts] = await Promise.all([
    type === "all" || type === "seller"
      ? prisma.sellerPayout.findMany({
          where:   { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { seller: { include: { user: { select: { email: true } } } }, order: { select: { id: true } } },
        })
      : [],

    type === "all" || type === "installer"
      ? prisma.installerPayout.findMany({
          where:   { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { installer: { include: { user: { select: { email: true } } } }, job: { select: { title: true } } },
        })
      : [],

    type === "all" || type === "vpp"
      ? prisma.vppPayout.findMany({
          where:   { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true, email: true } }, event: { select: { name: true } } },
        })
      : [],
  ]);

  const totalPending =
    sellerPayouts.reduce((s, p) => s + p.netAmount, 0) +
    installerPayouts.reduce((s, p) => s + p.netAmount, 0) +
    vppPayouts.reduce((s, p) => s + p.netAmount, 0);

  return ok({
    seller:    { payouts: sellerPayouts,    count: sellerPayouts.length,    total: sellerPayouts.reduce((s,p)=>s+p.netAmount,0) },
    installer: { payouts: installerPayouts, count: installerPayouts.length, total: installerPayouts.reduce((s,p)=>s+p.netAmount,0) },
    vpp:       { payouts: vppPayouts,       count: vppPayouts.length,       total: vppPayouts.reduce((s,p)=>s+p.netAmount,0) },
    totalPending: Math.round(totalPending * 100) / 100,
  });
}

// POST /api/payments/payouts?type=seller|installer&id= — trigger single payout
export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id   = searchParams.get("id");

  if (!type || !id) return err("type and id required", 400);

  if (type === "seller") {
    const payout = await prisma.sellerPayout.findUnique({
      where:   { id },
      include: { seller: { include: { user: true } } },
    });
    if (!payout) return err("Payout not found", 404);
    if (payout.status !== "PENDING") return err("Payout already processed", 409);
    if (!payout.seller.stripeAccountId) return err("Seller has no Stripe account connected", 400);

    try {
      const transfer = await transferToSeller({
        stripeAccountId: payout.seller.stripeAccountId,
        amount:          payout.netAmount,
        metadata:        { payoutId: payout.id, type: "seller_payout" },
      });

      await prisma.sellerPayout.update({
        where: { id },
        data:  { status: "PAID", stripeTransferId: transfer.id, settledAt: new Date() },
      });

      await sendSellerPayout(payout.seller, payout);
      logger.info("Seller payout processed", { payoutId: id, amount: payout.netAmount });

      return ok({ message: `Seller payout of $${payout.netAmount.toFixed(2)} sent.`, transferId: transfer.id });
    } catch (e) {
      await alertCritical("Seller payout failed", { payoutId: id, error: e.message });
      return err(`Transfer failed: ${e.message}`, 502);
    }
  }

  if (type === "installer") {
    const payout = await prisma.installerPayout.findUnique({
      where:   { id },
      include: { installer: { include: { user: true } } },
    });
    if (!payout) return err("Payout not found", 404);
    if (payout.status !== "PENDING") return err("Payout already processed", 409);
    if (!payout.installer.stripeAccountId) return err("Installer has no Stripe account connected", 400);

    try {
      const transfer = await transferToInstaller({
        stripeAccountId: payout.installer.stripeAccountId,
        amount:          payout.netAmount,
        metadata:        { payoutId: payout.id, type: "installer_payout" },
      });

      await prisma.installerPayout.update({
        where: { id },
        data:  { status: "PAID", stripeTransferId: transfer.id, settledAt: new Date() },
      });

      logger.info("Installer payout processed", { payoutId: id, amount: payout.netAmount });
      return ok({ message: `Installer payout of $${payout.netAmount.toFixed(2)} sent.`, transferId: transfer.id });
    } catch (e) {
      await alertCritical("Installer payout failed", { payoutId: id, error: e.message });
      return err(`Transfer failed: ${e.message}`, 502);
    }
  }

  return err("type must be seller or installer", 400);
}
