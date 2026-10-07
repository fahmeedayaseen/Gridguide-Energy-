import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
export async function GET(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller not found", 404);
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");
  const type    = searchParams.get("type");
  const logs = await prisma.sellerMessageLog.findMany({
    where: { sellerId: seller.id, ...(orderId && { orderId }), ...(type && { type }) },
    orderBy: { createdAt: "desc" }, take: 200,
    include: { customer: { select: { firstName:true, lastName:true, email:true } } },
  });
  return ok({ messages: logs });
}
