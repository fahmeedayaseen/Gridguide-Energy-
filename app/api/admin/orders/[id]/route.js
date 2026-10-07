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
    if (!order.stripePaymentIntentId) return err("No payment intent — cannot refund", 400);
    const amountCents = data.refundAmount
      ? Math.round(data.refundAmount * 100)
      : Math.round(order.total * 100);
    try {
      await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
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

  // Audit log
  await prisma.platformAuditLog.create({
    data: {
      action:    `ORDER_${data.status || "UPDATE"}`,
      entityType:"Order",
      entityId:  order.id,
      adminId:   auth.user.id,
      before:    JSON.stringify({ status: order.status }),
      after:     JSON.stringify(updateData),
    },
  }).catch(() => {});

  return ok({ order: updated, message: `Order updated` });
}
