/**
 * PATCH  /api/admin/rewards/catalog/[id] — edit a catalog item
 * DELETE /api/admin/rewards/catalog/[id] — remove a catalog item
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { logAudit } from "@/lib/audit.js";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(150).optional(),
  description: z.string().max(500).nullable().optional(),
  pointsCost: z.number().int().positive().optional(),
  dollarValue: z.number().positive().optional(),
  fulfillmentType: z.enum(["statement_credit", "cash", "gift_card", "donate"]).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.rewardCatalogItem.findUnique({ where: { id: params.id } });
  if (!existing) return err("Catalog item not found", 404);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const item = await prisma.rewardCatalogItem.update({ where: { id: params.id }, data });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "REWARD_CATALOG_ITEM_UPDATED", targetType: "RewardCatalogItem", targetId: params.id, category: "OTHER", metadata: { changes: data } });

  return ok({ item, message: "Catalog item updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.rewardCatalogItem.findUnique({ where: { id: params.id } });
  if (!existing) return err("Catalog item not found", 404);

  await prisma.rewardCatalogItem.delete({ where: { id: params.id } });

  await logAudit({ actorUserId: auth.user.id, actorRole: "ADMIN", action: "REWARD_CATALOG_ITEM_REMOVED", targetType: "RewardCatalogItem", targetId: params.id, category: "OTHER", metadata: { name: existing.name } });

  return ok({ message: "Catalog item removed." });
}
