/**
 * PATCH /api/marketplace/orders/[id]/fulfillment
 * Seller updates their portion of an order's fulfillment status.
 * Each seller in a multi-seller order manages only their own items.
 */
import { prisma }             from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole }        from "@/lib/jwt.js";
import { z }                  from "zod";

const fulfillSchema = z.object({
  status:         z.enum(["PROCESSING","SHIPPED","DELIVERED","CANCELLED"]),
  carrier:        z.string().max(100).optional(),
  trackingNumber: z.string().max(150).optional(),
  trackingUrl:    z.string().url().optional(),
  notes:          z.string().max(500).optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, fulfillSchema);
  if (error) return err("Validation failed", 400, error);

  // Verify seller owns items in this order
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller && auth.user.role !== "ADMIN") return err("Seller account not found", 404);

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { items: { include: { product: true } } },
  });
  if (!order) return err("Order not found", 404);

  if (auth.user.role !== "ADMIN") {
    const sellerItems = order.items.filter(i => i.product.sellerId === seller.id);
    if (!sellerItems.length) return err("You have no items in this order", 403);
  }

  const sellerId = seller?.id ?? (await prisma.seller.findFirst())?.id;

  const updateData = {
    status: data.status,
    ...(data.carrier       && { carrier: data.carrier }),
    ...(data.trackingNumber && { trackingNumber: data.trackingNumber }),
    ...(data.trackingUrl    && { trackingUrl: data.trackingUrl }),
    ...(data.notes          && { notes: data.notes }),
    ...(data.status === "SHIPPED"   && { shippedAt: new Date() }),
    ...(data.status === "DELIVERED" && { deliveredAt: new Date() }),
    ...(data.status === "CANCELLED" && { cancelledAt: new Date() }),
  };

  const fulfillment = await prisma.sellerFulfillment.upsert({
    where:  { orderId_sellerId: { orderId: params.id, sellerId } },
    create: { orderId: params.id, sellerId, ...updateData },
    update: updateData,
  });

  // If all seller fulfillments are shipped, update order-level status
  const allFulfillments = await prisma.sellerFulfillment.findMany({ where: { orderId: params.id } });
  if (allFulfillments.length > 0 && allFulfillments.every(f => f.status === "SHIPPED")) {
    await prisma.order.update({ where: { id: params.id }, data: { status: "SHIPPED", shippedAt: new Date() } });
  }

  return ok({ fulfillment, message: "Fulfillment updated" });
}
