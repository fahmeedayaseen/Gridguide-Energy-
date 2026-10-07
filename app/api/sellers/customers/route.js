/**
 * GET  /api/sellers/customers  — list seller's customers
 * POST /api/sellers/customers  — create/import a customer with consent
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const customerSchema = z.object({
  email:             z.string().email(),
  firstName:         z.string().max(80).optional(),
  lastName:          z.string().max(80).optional(),
  phone:             z.string().optional(),
  marketingOptIn:    z.boolean().default(false),
  source:            z.string().optional(),
});

export async function GET(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found", 404);

  const { searchParams } = new URL(request.url);
  const optInOnly = searchParams.get("optInOnly") === "true";
  const search    = searchParams.get("q");
  const page      = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit     = Math.min(100, parseInt(searchParams.get("limit") || "50"));

  const where = {
    sellerId: seller.id,
    ...(optInOnly && { marketingOptIn: true, marketingOptOutAt: null }),
    ...(search    && { OR: [
      { email:     { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName:  { contains: search, mode: "insensitive" } },
    ]}),
  };

  const [customers, total] = await Promise.all([
    prisma.sellerCustomer.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit }),
    prisma.sellerCustomer.count({ where }),
  ]);

  const optInTotal = await prisma.sellerCustomer.count({ where: { sellerId: seller.id, marketingOptIn: true, marketingOptOutAt: null } });
  return ok({ customers, total, optInTotal, page });
}

export async function POST(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
  if (!seller) return err("Seller account not found", 404);

  const body = await request.json().catch(() => null);
  if (!body) return err("Invalid request body", 400);

  // Support both single and bulk import
  const rows = Array.isArray(body) ? body : [body];
  let imported = 0, skipped = 0, errors = [];

  for (const rawRow of rows) {
    const parsed = customerSchema.safeParse(rawRow);
    if (!parsed.success) { errors.push({ email: rawRow.email, error: parsed.error.issues[0]?.message }); continue; }
    const row = parsed.data;
    // P1: load existing customer to preserve consent timestamps
    const existingCust = await prisma.sellerCustomer.findUnique({
      where: { sellerId_email: { sellerId: seller.id, email: row.email } },
      select: { marketingOptIn:true, marketingOptInAt:true, marketingOptOutAt:true },
    });
    const consentData = row.marketingOptIn
      ? { marketingOptIn: true, marketingOptInAt: existingCust?.marketingOptInAt || new Date(), marketingOptOutAt: null }
      : { marketingOptIn: false, marketingOptOutAt: existingCust?.marketingOptIn ? new Date() : existingCust?.marketingOptOutAt };

    await prisma.sellerCustomer.upsert({
      where:  { sellerId_email: { sellerId: seller.id, email: row.email } },
      create: { sellerId: seller.id, email: row.email, firstName: row.firstName, lastName: row.lastName,
                phone: row.phone, source: row.source || "import", ...consentData },
      update: { ...consentData },
    }).then(() => imported++).catch(e => errors.push({ email: row.email, error: e.message }));
  }

  return ok({ imported, skipped, errors }, 201);
}
