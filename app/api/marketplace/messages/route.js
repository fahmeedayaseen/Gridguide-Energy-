/**
 * POST /api/marketplace/messages
 * Homeowner/buyer sends a message to a seller about a product.
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z }                   from "zod";

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request,
    z.object({
      productId: z.string(),
      body: z.string().min(1).max(2000),
      replyTo: z.string().optional(),
    })
  );
  if (error) return err("Validation failed", 400, error);

  // Resolve product → seller
  const product = await prisma.product.findUnique({
    where: { id: data.productId },
    select: { sellerId: true, status: true },
  });
  if (!product) return err("Product not found.", 404);
  if (product.status !== "ACTIVE") return err("This product is not currently available.", 400);

  const message = await prisma.sellerMessage.create({
    data: {
      sellerId:  product.sellerId,
      buyerId:   auth.user.id,
      productId: data.productId,
      body:      data.body,
      replyTo:   data.replyTo || null,
      read:      false,
    },
  });

  return ok({ message, sent: true }, 201);
}
