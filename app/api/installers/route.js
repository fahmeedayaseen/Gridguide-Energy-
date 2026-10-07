import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { cacheGet, cacheSet } from "@/lib/redis.js";
import { rateLimit } from "@/lib/redis.js";

// GET /api/installers — public list of verified installers
export async function GET(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`installers-directory:${ip}`, 120, 60); // 120/min
  if (!allowed) return err("Too many requests", 429);

  const { searchParams } = new URL(request.url);
  const specialty = searchParams.get("specialty") || "";
  const city      = searchParams.get("city") || "";
  const state     = searchParams.get("state") || "";
  const plan      = searchParams.get("plan") || "";
  const page      = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit     = Math.min(50, parseInt(searchParams.get("limit") || "20"));
  const skip      = (page - 1) * limit;

  const cacheKey = `installers:${specialty}:${city}:${state}:${plan}:${page}`;
  const cached   = await cacheGet(cacheKey);
  if (cached) return ok(cached);

  const where = {
    verificationStatus: "VERIFIED",
    ...(specialty && {
      specialties: { has: specialty },
    }),
    ...(state && {
      serviceAreas: { hasSome: [`${city ? city + ", " : ""}${state}`] },
    }),
    ...(plan && { plan }),
  };

  const [installers, total] = await Promise.all([
    prisma.installer.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { plan: "desc" },   // Enterprise first, then Pro, then Free
        { rating: "desc" },
        { reviewCount: "desc" },
      ],
      select: {
        id: true, companyName: true, nabcepCertified: true,
        plan: true, rating: true, reviewCount: true,
        jobsCompleted: true, serviceAreas: true, specialties: true,
        user: { select: { name: true, avatar: true, createdAt: true } },
        reviews: {
          take: 3,
          orderBy: { createdAt: "desc" },
          select: { rating: true, comment: true, jobType: true, createdAt: true },
        },
      },
    }),
    prisma.installer.count({ where }),
  ]);

  const result = { installers, total, page, pages: Math.ceil(total / limit) };
  await cacheSet(cacheKey, result, 120);
  return ok(result);
}
