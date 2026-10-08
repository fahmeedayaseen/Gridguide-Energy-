/**
 * GET   /api/admin/orders/[id] — full order receipt with payout splits
 * PATCH /api/admin/orders/[id] — update status, tracking, or issue refund
 */
import { prisma }         from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole }    from "@/lib/jwt.js";
import { stripe }         from "@/lib/stripe.js";
import { z }              from "zod";

const VALID_TRANSITIONS = {
  PENDING:    ["PROCESSING","CANCELLED"],
  PROCESSING: ["SHIPPED","CANCELLED"],
  SHIPPED:    ["DELIVERED"],
  DELIVERED:  ["REFUNDED"],
  PAID:       ["PROCESSING","CANCELLED","REFUNDED"],
  CANCELLED:  [],
  REFUNDED:   [],
};

const patchSchema = z.object({
  status:            z.enum(["PROCESSING","SHIPPED","DELIVERED","CANCELLED","REFUNDED"]).optional(),
  carrier:           z.string().max(100).optional(),
  trackingNumber:    z.string().max(150).optional(),
  cancellationReason:z.string().max(500).optional(),
  refundAmount:      z.number().positive().optional(),
}).strict();

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: {
      user:  { select: { id:true, name:true, email:true } },
      items: { include: { product: { select: { name:true, images:true, seller: { select: { id:true, companyName:true } } } } } },
      payouts: { include: { seller: { select: { id:true, companyName:true } } } },
      fulfillments: { include: { seller: { select: { id:true, companyName:true } } } },
    },
  });
  if (!order) return err("Order not found", 404);
  return ok({ order });
}

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, patchSchema);
  if (error) return err("Validation failed", 400, error);

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) return err("Order not found", 404);

  if (data.status) {
    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (!allowed.includes(data.status)) {
      return err(`Cannot transition from ${order.status} to ${data.status}`, 400);
    }
  }

  const updateData = {
    ...(data.status          && { status: data.status }),
    ...(data.carrier         && { carrier: data.carrier }),
    ...(data.trackingNumber  && { trackingNumber: data.trackingNumber }),
    ...(data.cancellationReason && { cancellationReason: data.cancellationReason }),
  };

  if (data.status === "SHIPPED") {
    updateData.shippedAt = new Date();
    // Update all seller fulfillments to SHIPPED
    await prisma.sellerFulfillment.updateMany({
      where: { orderId: order.id, status: { in: ["PENDING","PROCESSING"] } },
      data:  { status: "SHIPPED", shippedAt: new Date(),
                ...(data.carrier       && { carrier: data.carrier }),
                ...(data.trackingNumber && { trackingNumber: data.trackingNumber }) },
    });
  }
  if (data.status === "DELIVERED") updateData.deliveredAt = new Date();
  if (data.status === "CANCELLED") updateData.cancelledAt = new Date();

  // Refund flow
  if (data.status === "REFUNDED") {
    // The Order model stores the PaymentIntent as `stripePaymentId` (written by
    // the checkout webhook). The old `stripePaymentIntentId` field never
    // existed, so every refund on a real paid order was blocked.
    if (!order.stripePaymentId) return err("No payment on record — cannot refund", 400);
    if (data.refundAmount != null && data.refundAmount > order.total) {
      return err(`Refund amount ($${data.refundAmount.toFixed(2)}) exceeds the order total ($${order.total.toFixed(2)})`, 400);
    }
    // REFUNDED is terminal in VALID_TRANSITIONS, so a second refund can't stack on the first.
    const amountCents = data.refundAmount
      ? Math.round(data.refundAmount * 100)
      : Math.round(order.total * 100);
    try {
      await stripe.refunds.create({
        payment_intent: order.stripePaymentId,
        amount: amountCents,
        reason: "requested_by_customer",
      });
    } catch (e) {
      return err(`Stripe refund failed: ${e.message}`, 502);
    }
    updateData.refundedAt    = new Date();
    updateData.refundAmount  = data.refundAmount ?? order.total;
  }

  const updated = await prisma.order.update({
    where: { id: params.id },
    data: updateData,
  });

  // Audit log — field names must match the PlatformAuditLog model (the old
  // entityType/entityId/adminId/before/after fields don't exist, so every
  // write threw and was swallowed: no admin order action was ever logged).
  await prisma.platformAuditLog.create({
    data: {
      actorUserId: auth.user.id,
      actorRole:   "ADMIN",
      action:      `ORDER_${data.status || "UPDATE"}`,
      targetType:  "Order",
      targetId:    order.id,
      category:    data.status === "REFUNDED" ? "BILLING" : "OTHER",
      metadata:    { before: { status: order.status }, after: updateData },
    },
  }).catch((e) => console.error("[admin/orders] audit log failed:", e.message));

  return ok({ order: updated, message: `Order updated` });
}
