/**
 * GET /api/seller/orders?status=PAID
 * Returns order items for the authenticated seller using the current schema.
 * Uses OrderItem (not Order.product) and Order.user (not Order.buyer).
 */
import { prisma }     from "@/lib/db.js";
import { ok, err }    from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status")?.toUpperCase();

  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found.", 404);

  const items = await prisma.orderItem.findMany({
    where: {
      product: { sellerId: seller.id },
      ...(statusFilter && { order: { status: statusFilter } }),
    },
    include: {
      product: { select: { id:true, name:true, images:true } },
      order: {
        include: {
          user:         { select: { id:true, name:true, email:true } },
          fulfillments: { where: { sellerId: seller.id } },
        },
      },
    },
    orderBy: { order: { createdAt: "desc" } },
    take: 200,
  });

  const orders = items.map(i => ({
    orderId:        i.order.id,
    orderItemId:    i.id,
    product:        i.product,
    quantity:       i.quantity,
    unitPrice:      i.price,
    lineTotal:      i.price * i.quantity,
    status:         i.order.status,
    customer:       i.order.user,
    createdAt:      i.order.createdAt,
    fulfillment:    i.order.fulfillments[0] ?? null,
  }));

  const totals = {
    count:        orders.length,
    grossRevenue: orders.reduce((s,o) => s + o.lineTotal, 0),
    paid:         orders.filter(o => o.status === "PAID").length,
    shipped:      orders.filter(o => o.status === "SHIPPED").length,
    pending:      orders.filter(o => o.status === "PENDING").length,
  };

  return ok({ orders, totals });
}
