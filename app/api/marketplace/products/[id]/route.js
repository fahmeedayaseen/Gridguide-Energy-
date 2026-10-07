import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { cacheDelPattern } from "@/lib/redis.js";
import { z } from "zod";

const updateSchema = z.object({
  name:        z.string().min(2).max(200).optional(),
  description: z.string().optional(),
  price:       z.number().positive().optional(),
  salePrice:   z.number().positive().nullable().optional(),
  inventory:   z.number().int().min(0).optional(),
  images:      z.array(z.string().url()).optional(),
  specs:       z.record(z.string()).optional(),
});

// GET /api/marketplace/products/[id]
export async function GET(request, { params }) {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: {
      seller: { select: { businessName: true, verificationStatus: true, rating: true } },
    },
  });

  if (!product || product.status === "INACTIVE") {
    return err("Product not found", 404);
  }

  // Increment view count
  await prisma.product.update({ where: { id: params.id }, data: { viewCount: { increment: 1 } } });

  return ok({ product });
}

// PATCH /api/marketplace/products/[id]
export async function PATCH(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { seller: true },
  });
  if (!product) return err("Product not found", 404);
  if (product.seller.userId !== auth.user.id && auth.user.role !== "ADMIN") {
    return err("Unauthorized", 403);
  }

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const updated = await prisma.product.update({
    where: { id: params.id },
    data: { ...data, ...(auth.user.role !== "ADMIN" && { status: "PENDING_REVIEW" }) },
  });

  await cacheDelPattern("products:*");
  return ok({ product: updated, message: auth.user.role === "ADMIN" ? "Updated." : "Changes submitted for review." });
}

// DELETE /api/marketplace/products/[id]
export async function DELETE(request, { params }) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: { seller: true },
  });
  if (!product) return err("Product not found", 404);
  if (product.seller.userId !== auth.user.id && auth.user.role !== "ADMIN") {
    return err("Unauthorized", 403);
  }

  // Soft delete — mark inactive rather than hard delete
  await prisma.product.update({ where: { id: params.id }, data: { status: "INACTIVE" } });
  await cacheDelPattern("products:*");

  return ok({ message: "Product removed from marketplace." });
}
