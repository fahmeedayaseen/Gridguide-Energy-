import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { sendProductApproved } from "@/lib/email.js";
import { z } from "zod";

const updateSellerSchema = z.object({
  verificationStatus: z.enum(["PENDING","VERIFIED","REJECTED","SUSPENDED"]),
  plan:               z.enum(["FREE","PRO"]).optional(),
  commissionRate:     z.number().min(0).max(1).optional(),
  note:               z.string().optional(), // internal admin note
}).strict();

// GET /api/admin/sellers — list sellers by status
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "PENDING";
  const page   = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit  = parseInt(searchParams.get("limit") || "50");
  const skip   = (page - 1) * limit;

  const [sellers, total] = await Promise.all([
    prisma.seller.findMany({
      where:   { verificationStatus: status },
      skip, take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user:     { select: { name: true, email: true, phone: true, createdAt: true } },
        products: { select: { id: true, name: true, status: true }, take: 5 },
        _count:   { select: { products: true } },
      },
    }),
    prisma.seller.count({ where: { verificationStatus: status } }),
  ]);

  return ok({ sellers, total, page, pages: Math.ceil(total / limit) });
}

// PATCH /api/admin/sellers?id= — approve/reject/suspend seller
export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const sellerId = searchParams.get("id");
  if (!sellerId) return err("Seller ID required", 400);

  const { data, error } = await parseBody(request, updateSellerSchema);
  if (error) return err("Validation failed", 400, error);

  const seller = await prisma.seller.update({
    where:   { id: sellerId },
    data:    { verificationStatus: data.verificationStatus, ...(data.plan && { plan: data.plan }), ...(data.commissionRate && { commissionRate: data.commissionRate }) },
    include: { user: true },
  });

  // Notify seller of approval/rejection
  if (data.verificationStatus === "VERIFIED") {
    await prisma.notification.create({
      data: {
        userId:  seller.userId,
        type:    "SELLER_APPROVED",
        title:   "Seller Account Approved!",
        message: "Your GridGuide seller account has been verified. You can now list products on the marketplace.",
      },
    });
  } else if (data.verificationStatus === "REJECTED") {
    await prisma.notification.create({
      data: {
        userId:  seller.userId,
        type:    "SELLER_REJECTED",
        title:   "Seller Application Update",
        message: data.note || "Your seller application requires additional information. Please contact support.",
      },
    });
  }

  return ok({ seller: { id: seller.id, verificationStatus: seller.verificationStatus } });
}
