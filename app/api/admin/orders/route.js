/**
 * GET /api/admin/orders — paginated order list for the admin lookup tool.
 * Search by order ID (partial), buyer email, or filter by status.
 * See GET /api/admin/orders/[id] for the full transaction receipt.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const page   = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") || "25"));

  const where = {
    ...(status && { status }),
    ...(search && {
      OR: [
        { id: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { user: { name: { contains: search, mode: "insensitive" } } },
      ],
    }),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where, skip: (page - 1) * limit, take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, email: true } },
        items: { select: { quantity: true, price: true, product: { select: { name: true } } } },
        _count: { select: { payouts: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return ok({
    // Shape matches what the admin Sales screen reads (user object, items
    // with product names, carrier/tracking). The old flattened `buyer` string
    // rendered every real order with a blank customer, items and tracking.
    orders: orders.map((o) => ({
      id: o.id, status: o.status, total: o.total, subtotal: o.subtotal, createdAt: o.createdAt,
      user: o.user ? { name: o.user.name, email: o.user.email } : null,
      buyer: o.user?.name || o.user?.email || "Unknown",
      items: o.items.map((i) => ({ quantity: i.quantity, price: i.price, product: { name: i.product?.name || "Item" } })),
      itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
      sellerCount: o._count.payouts,
      carrier: o.carrier || null,
      trackingNumber: o.trackingNumber || null,
      cancellationReason: o.cancellationReason || null,
      refundAmount: o.refundAmount ?? null,
    })),
    total, page, pages: Math.ceil(total / limit),
  });
}
