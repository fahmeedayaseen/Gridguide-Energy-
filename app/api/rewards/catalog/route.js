/**
 * GET /api/rewards/catalog — active, admin-configured redeemable items.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const items = await prisma.rewardCatalogItem.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return ok({ items });
}
