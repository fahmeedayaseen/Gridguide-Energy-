/**
 * GET  /api/seller/messages          — list all buyer messages for the seller
 * POST /api/seller/messages          — send a reply from seller to buyer
 * PATCH /api/seller/messages?id=X    — mark message(s) as read
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { requireRole }         from "@/lib/jwt.js";
import { z }                   from "zod";

export async function GET(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found.", 404);

  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread") === "true";

  const messages = await prisma.sellerMessage.findMany({
    where: {
      sellerId: seller.id,
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      buyer:   { select: { name: true, email: true } },
      product: { select: { name: true } },
    },
  });

  const unreadCount = await prisma.sellerMessage.count({
    where: { sellerId: seller.id, read: false },
  });

  return ok({
    messages: messages.map(m => ({
      id:          m.id,
      body:        m.body,
      senderName:  m.buyer?.name  || "Buyer",
      senderEmail: m.buyer?.email || null,
      productName: m.product?.name || null,
      productId:   m.productId,
      buyerId:     m.buyerId,
      read:        m.read,
      replyTo:     m.replyTo,
      createdAt:   m.createdAt,
    })),
    unreadCount,
  });
}

export async function POST(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request,
    z.object({ buyerId: z.string(), body: z.string().min(1).max(2000), productId: z.string().optional(), replyTo: z.string().optional() })
  );
  if (error) return err("Validation failed", 400, error);

  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found.", 404);

  const message = await prisma.sellerMessage.create({
    data: {
      sellerId:  seller.id,
      buyerId:   data.buyerId,
      body:      data.body,
      productId: data.productId || null,
      replyTo:   data.replyTo || null,
      read:      true, // seller-sent messages start as read
    },
  });

  return ok({ message }, 201);
}

export async function PATCH(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found.", 404);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    await prisma.sellerMessage.updateMany({
      where: { id, sellerId: seller.id },
      data: { read: true },
    });
  } else {
    // Mark all unread as read
    await prisma.sellerMessage.updateMany({
      where: { sellerId: seller.id, read: false },
      data: { read: true },
    });
  }

  return ok({ message: "Marked as read." });
}
