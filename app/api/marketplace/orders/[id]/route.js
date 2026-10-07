/**
 * GET /api/marketplace/orders/[id] — the Homeowner Receipt.
 *
 * Customer-facing only: items, quantities, total, and shipment status.
 * Deliberately does NOT include commission, processing fee, seller payout
 * amounts, or any other internal marketplace financial detail — showing a
 * buyer the seller's payout math is confusing ("why am I seeing this?"),
 * exposes internal business mechanics, and invites support questions if a
 * payout is delayed for reasons that have nothing to do with their order.
 * See GET /api/sellers/payouts/[id] and GET /api/admin/orders/[id] for the
 * seller- and admin-facing views of the same order.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

// Homeowner-facing status labels, distinct from the raw OrderStatus enum —
// "PAID" internally means "payment confirmed, not yet shipped", which reads
// oddly to a customer expecting to see where their package actually is.
const HOMEOWNER_STATUS_STEPS = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"];
const HOMEOWNER_STATUS_LABEL = {
  PENDING:    "Awaiting Payment",
  PAID:       "Order Received",
  PROCESSING: "Preparing for Shipment",
  SHIPPED:    "Shipped",
  DELIVERED:  "Delivered",
  REFUNDED:   "Refunded",
  CANCELLED:  "Cancelled",
};

export async function GET(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      items: { include: { product: { select: { name: true, images: true } } } },
      user:  { select: { id: true, name: true, email: true } },
    },
  });
  if (!order) return err("Order not found", 404);
  if (order.userId !== auth.user.id && auth.user.role !== "ADMIN") {
    return err("Unauthorized", 403);
  }

  const currentIdx = HOMEOWNER_STATUS_STEPS.indexOf(order.status);

  return ok({
    order: {
      id:     order.id,
      date:   order.createdAt,
      status: order.status,
      statusLabel: HOMEOWNER_STATUS_LABEL[order.status] || order.status,
      items: order.items.map((i) => ({
        name:     i.product.name,
        image:    i.product.images?.[0] || null,
        quantity: i.quantity,
        price:    i.price,
      })),
      subtotal: order.subtotal,
      total:    order.total,
      shippingAddress: order.shippingAddress,
      // A simple linear progress indicator for the four post-payment steps.
      // "Leave a Review" is a frontend-only prompt shown once DELIVERED —
      // there's no dedicated backend state for it (reviews are freeform,
      // not gated behind a specific order step in the schema today).
      timeline: HOMEOWNER_STATUS_STEPS.map((step, i) => ({
        step, label: HOMEOWNER_STATUS_LABEL[step], done: currentIdx >= i,
      })),
    },
  });
}
