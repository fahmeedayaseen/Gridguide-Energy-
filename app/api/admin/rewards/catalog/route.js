/**
 * GET  /api/admin/rewards/catalog — list all catalog items (active + inactive)
 * POST /api/admin/rewards/catalog — add a redeemable item
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(150),
  description: z.string().max(500).optional(),
  pointsCost: z.number().int().positive(),
  dollarValue: z.number().positive(),
  fulfillmentType: z.enum(["statement_credit", "cash", "gift_card", "donate"]),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);
  const items = await prisma.rewardCatalogItem.findMany({ orderBy: { sortOrder: "asc" } });
  return ok({ items });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const item = await prisma.rewardCatalogItem.create({ data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "REWARD_CATALOG_ITEM_CREATED", targetType: "RewardCatalogItem", targetId: item.id, category: "OTHER", metadata: data });

  return ok({ item, message: "Catalog item added." }, 201);
}
