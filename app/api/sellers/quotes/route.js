import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";
const quoteSchema = z.object({
  customerId:     z.string().optional(),
  customerEmail:  z.string().email().optional(),
  lineItems:      z.array(z.object({ productId:z.string(), name:z.string(), qty:z.number(), unitPrice:z.number() })),
  discountAmount: z.number().default(0),
  taxAmount:      z.number().default(0),
  shippingAmount: z.number().default(0),
  expiresAt:      z.string().datetime().optional(),
  notes:          z.string().optional(),
});
export async function GET(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller not found", 404);
  const quotes = await prisma.sellerQuote.findMany({ where: { sellerId: seller.id }, orderBy: { createdAt: "desc" }, take: 100, include: { customer: { select: { firstName:true, lastName:true, email:true } } } });
  return ok({ quotes });
}
export async function POST(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller not found", 404);
  const { data, error } = await parseBody(request, quoteSchema);
  if (error) return err("Validation failed", 400, error);
  const subtotal = data.lineItems.reduce((s,i) => s + i.qty*i.unitPrice, 0);
  const total = subtotal - data.discountAmount + data.taxAmount + data.shippingAmount;
  const quoteNumber = `Q-${seller.id.slice(-4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const quote = await prisma.sellerQuote.create({
    data: { sellerId:seller.id, customerId:data.customerId||null, createdByUserId:auth.user.id, quoteNumber, subtotal, discountAmount:data.discountAmount, taxAmount:data.taxAmount, shippingAmount:data.shippingAmount, total, expiresAt:data.expiresAt?new Date(data.expiresAt):null, notes:data.notes, lineItemsJson:data.lineItems },
  });
  return ok({ quote }, 201);
}
