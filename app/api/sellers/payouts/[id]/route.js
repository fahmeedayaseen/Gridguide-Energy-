/**
 * GET /api/sellers/payouts/[id] — the Seller Settlement Receipt.
 *
 * Seller-facing: gross amount, commission, processing fee, net payout, and
 * payout status/schedule for ONE settlement. Scoped to only the requesting
 * seller's own line items within the order — if an order spans multiple
 * sellers, each seller only ever sees their own cut, never anyone else's
 * items, prices, or payout amounts.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

const SELLER_STATUS_STEPS = ["PENDING", "PAID"];
const SELLER_STATUS_LABEL = {
  PENDING: "Payout Scheduled",
  PAID:    "Paid",
  FAILED:  "Payout Failed — contact support",
};

export async function GET(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const payout = await prisma.sellerPayout.findUnique({
    where: { id: params.id },
    include: {
      seller: { select: { userId: true, businessName: true } },
      order: {
        include: {
          items: { include: { product: { select: { id: true, name: true, sellerId: true } } } },
        },
      },
    },
  });
  if (!payout) return err("Payout not found", 404);
  if (payout.seller.userId !== auth.user.id && auth.user.role !== "ADMIN") {
    return err("Unauthorized", 403);
  }

  // Only this seller's own line items from the order — never another
  // seller's products, prices, or quantities, even if they shared an order.
  const myItems = payout.order.items.filter((i) => i.product.sellerId === payout.sellerId);

  return ok({
    settlement: {
      id:       payout.id,
      orderId:  payout.orderId,
      status:   payout.status,
      statusLabel: SELLER_STATUS_LABEL[payout.status] || payout.status,
      items: myItems.map((i) => ({ name: i.product.name, quantity: i.quantity, price: i.price })),
      grossAmount:   payout.grossAmount,
      commission:    payout.commission,
      processingFee: payout.processingFee,
      netAmount:     payout.netAmount,
      scheduledFor:  payout.scheduledFor,
      settledAt:     payout.settledAt,
      createdAt:     payout.createdAt,
    },
  });
}
