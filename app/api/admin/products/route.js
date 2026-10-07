import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { sendProductApproved } from "@/lib/email.js";
import { z } from "zod";

const moderateSchema = z.object({
  status:  z.enum(["ACTIVE","REJECTED","INACTIVE"]),
  featured: z.boolean().optional(),
  note:    z.string().optional(),
}).strict();

// GET /api/admin/products — product review queue
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "PENDING_REVIEW";
  const page   = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const skip   = (page - 1) * 50;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where:   { status },
      skip, take: 50,
      orderBy: { createdAt: "desc" },
      include: {
        seller: {
          select: {
            businessName: true, verificationStatus: true,
            user: { select: { email: true } },
          },
        },
      },
    }),
    prisma.product.count({ where: { status } }),
  ]);

  return ok({ products, total, page, pages: Math.ceil(total / 50) });
}

// PATCH /api/admin/products?id= — approve/reject product
export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("id");
  if (!productId) return err("Product ID required", 400);

  const { data, error } = await parseBody(request, moderateSchema);
  if (error) return err("Validation failed", 400, error);

  const product = await prisma.product.update({
    where:   { id: productId },
    data:    { status: data.status, ...(data.featured !== undefined && { featured: data.featured }) },
    include: { seller: { include: { user: true } } },
  });

  if (data.status === "ACTIVE") {
    await sendProductApproved(product.seller, product);
    await prisma.notification.create({
      data: {
        userId:  product.seller.userId,
        type:    "PRODUCT_APPROVED",
        title:   "Product Approved",
        message: `Your product "${product.name}" is now live on the GridGuide Marketplace.`,
      },
    });
  } else if (data.status === "REJECTED") {
    await prisma.notification.create({
      data: {
        userId:  product.seller.userId,
        type:    "PRODUCT_REJECTED",
        title:   "Product Listing Update",
        message: data.note || `Your product "${product.name}" requires changes before it can be listed. Please contact support.`,
      },
    });
  }

  return ok({ product: { id: product.id, name: product.name, status: product.status } });
}
