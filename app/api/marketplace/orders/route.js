import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { createCheckoutSession, calculateFees } from "@/lib/stripe.js";
import { z } from "zod";

const orderSchema = z.object({
  items: z.array(z.object({
    productId: z.string(),
    quantity:  z.number().int().positive(),
  })).min(1),
  shippingAddress: z.object({
    line1:   z.string(),
    city:    z.string(),
    state:   z.string(),
    zip:     z.string(),
    country: z.string().default("US"),
  }),
});

// GET /api/marketplace/orders — user's order history, OR
// GET /api/marketplace/orders?seller=true — orders containing the
// authenticated seller's own products (a fundamentally different query from
// "orders I placed as a buyer" — no endpoint previously existed for this at
// all, so the Seller Portal's Orders tab had nothing real to call).
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);

  if (searchParams.get("seller") === "true") {
    const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
    if (!seller) return err("Seller account not found.", 404);

    const items = await prisma.orderItem.findMany({
      where: { product: { sellerId: seller.id } },
      include: {
        product: { select: { name: true, images: true } },
        order:   { include: { user: { select: { name: true, email: true } } } },
      },
      orderBy: { order: { createdAt: "desc" } },
    });

    // One payout per (seller, order) — fetched separately and matched by
    // orderId so each order row can link straight to its settlement receipt
    // (GET /api/sellers/payouts/[id]) without a per-row query.
    const orderIds = [...new Set(items.map((i) => i.order.id))];
    const payouts = await prisma.sellerPayout.findMany({
      where: { sellerId: seller.id, orderId: { in: orderIds } },
      select: { id: true, orderId: true },
    });
    const payoutByOrderId = Object.fromEntries(payouts.map((p) => [p.orderId, p.id]));

    const orders = items.map((i) => ({
      id:         i.order.id,
      product:    i.product.name,
      customer:   i.order.user?.name || i.order.user?.email || "Unknown",
      date:       i.order.createdAt,
      quantity:   i.quantity,
      amount:     i.price * i.quantity,
      status:     i.order.status,
      payoutId:   payoutByOrderId[i.order.id] || null,
    }));

    return ok({ orders });
  }

  const orders = await prisma.order.findMany({
    where: { userId: auth.user.id },
    include: {
      items: { include: { product: { select: { name: true, images: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return ok({ orders });
}

// POST /api/marketplace/orders — create order and return Stripe checkout URL
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, orderSchema);
  if (error) return err("Validation failed", 400, error);

  // Fetch products and validate inventory
  const products = await prisma.product.findMany({
    where: {
      id: { in: data.items.map((i) => i.productId) },
      status: "ACTIVE",
    },
    include: { seller: true },
  });

  if (products.length !== data.items.length) {
    return err("One or more products are unavailable.");
  }

  // Build line items with pricing
  const lineItems = data.items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const price = product.salePrice || product.price;
    return { ...item, name: product.name, price, images: product.images };
  });

  const subtotal = lineItems.reduce((s, i) => s + i.price * i.quantity, 0);
  // Preliminary estimate only — the webhook's checkout.session.completed
  // handler recalculates this correctly per-seller once payment is
  // confirmed, which is what actually determines seller payouts. This
  // previously hardcoded "FREE" regardless of the seller's real plan, so
  // a seller paying for PRO's lower 8% rate would see a PENDING order
  // estimated at the FREE tier's 10% instead.
  const primarySellerPlan = products[0]?.seller?.plan || "FREE";
  const { commission, processingFee } = calculateFees(subtotal, "SELLER", primarySellerPlan);
  const total = subtotal;

  // Create order record (PENDING until Stripe confirms payment)
  const order = await prisma.order.create({
    data: {
      userId:          auth.user.id,
      status:          "PENDING",
      subtotal,
      commission,
      processingFee,
      total,
      shippingAddress: data.shippingAddress,
      items: {
        create: data.items.map((item) => {
          const product = products.find((p) => p.id === item.productId);
          return {
            productId: item.productId,
            quantity:  item.quantity,
            price:     product.salePrice || product.price,
          };
        }),
      },
    },
  });

  // Create Stripe checkout session
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  const session = await createCheckoutSession({
    userId:        auth.user.id,
    orderId:       order.id,
    items:         lineItems,
    customerEmail: auth.user.email,
    successUrl:    `${baseUrl}/platform?checkout=success&order=${order.id}`,
    cancelUrl:     `${baseUrl}/platform?checkout=cancelled`,
  });

  // Attach Stripe session ID to order
  await prisma.order.update({
    where: { id: order.id },
    data:  { stripeSessionId: session.id },
  });

  return ok({ orderId: order.id, checkoutUrl: session.url }, 201);
}
