import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest, requireRole } from "@/lib/jwt.js";
import { cacheGet, cacheSet, cacheDelPattern } from "@/lib/redis.js";
import { z } from "zod";

const productSchema = z.object({
  name:         z.string().min(2).max(200),
  description:  z.string().min(10),
  category:     z.enum(["SOLAR","BATTERY","EV_CHARGING","SMART_PANEL","THERMOSTAT","MONITORING","ACCESSORIES"]),
  price:        z.number().positive(),
  salePrice:    z.number().positive().optional(),
  inventory:    z.number().int().min(0).default(0),
  images:       z.array(z.string().url()).default([]),
  specs:        z.record(z.string()).optional(),
  rebateEligible: z.boolean().default(false),
  rebateAmount: z.number().optional(),
});

// GET /api/marketplace/products — public listing with filters, OR
// GET /api/marketplace/products?mine=true — the authenticated seller's own
// products regardless of status (PENDING_REVIEW, INACTIVE, etc). The public
// branch only ever returns ACTIVE products, so sellers had no way to see
// their own pending/rejected/inactive listings at all before this.
export async function GET(request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("mine") === "true") {
    const auth = await authenticateRequest(request);
    if (auth.error) return err(auth.error, auth.status);

    const seller = await prisma.seller.findUnique({ where: { userId: auth.user.id } });
    if (!seller) return err("Seller account not found.", 404);

    const products = await prisma.product.findMany({
      where: { sellerId: seller.id },
      orderBy: { createdAt: "desc" },
    });
    return ok({ products, total: products.length });
  }

  // GET /api/marketplace/products?adminReview=true — every seller's pending
  // products, for the admin review queue. Admin-only; the public branch
  // below only ever returns ACTIVE products.
  if (searchParams.get("adminReview") === "true") {
    const auth = await requireRole(request, "ADMIN");
    if (auth.error) return err(auth.error, auth.status);

    const products = await prisma.product.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { createdAt: "asc" },
      include: { seller: { select: { businessName: true } } },
    });
    return ok({ products, total: products.length });
  }

  const category  = searchParams.get("category");
  const search    = searchParams.get("q") || "";
  const featured  = searchParams.get("featured") === "true";
  const page      = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit     = Math.min(50, parseInt(searchParams.get("limit") || "20"));
  const skip      = (page - 1) * limit;

  const cacheKey = `products:${category}:${search}:${featured}:${page}:${limit}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return ok(cached);

  const where = {
    status: "ACTIVE",
    ...(category && { category }),
    ...(featured && { featured: true }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where, skip, take: limit,
      orderBy: [{ featured: "desc" }, { soldCount: "desc" }, { createdAt: "desc" }],
      include: {
        seller: { select: { businessName: true, verificationStatus: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  const result = { products, total, page, pages: Math.ceil(total / limit) };
  await cacheSet(cacheKey, result, 120); // 2 min cache
  return ok(result);
}

// POST /api/marketplace/products — seller creates product (goes to review queue)
export async function POST(request) {
  const auth = await requireRole(request, "SELLER", "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, productSchema);
  if (error) return err("Validation failed", 400, error);

  // Get seller record
  const seller = await prisma.seller.findUnique({
    where: { userId: auth.user.id },
    include: { _count: { select: { products: true } } },
  });
  if (!seller) return err("Seller account not found. Complete seller registration first.", 404);
  if (seller.verificationStatus !== "VERIFIED") {
    return err("Your seller account must be verified before listing products.", 403);
  }

  // ── Seller plan listing limits ────────────────────────────────────────────
  // Free:       max 10 active listings, standard storefront
  // Pro:        unlimited listings, featured placement
  // Enterprise: unlimited listings, co-branded storefront
  const LISTING_LIMITS = { FREE: 10, PRO: -1, ENTERPRISE: -1 };
  const sellerPlan = (seller.plan || "FREE").toUpperCase();
  const listingLimit = LISTING_LIMITS[sellerPlan] ?? 10;

  if (listingLimit !== -1) {
    const activeListings = await prisma.product.count({
      where: { sellerId: seller.id, status: { not: "DELETED" } },
    });
    if (activeListings >= listingLimit) {
      return err(
        `Your ${sellerPlan === "BASIC" ? "Basic" : sellerPlan} seller plan allows up to ${listingLimit} listings. Upgrade to Pro for unlimited listings.`,
        403,
        { upgradeRequired: true, currentCount: activeListings, limit: listingLimit }
      );
    }
  }

  const product = await prisma.product.create({
    data: { ...data, sellerId: seller.id, status: "PENDING_REVIEW" },
  });

  // Invalidate product cache
  await cacheDelPattern("products:*");

  return ok({ product, message: "Product submitted for review. It will be visible within 1-2 business days." }, 201);
}
