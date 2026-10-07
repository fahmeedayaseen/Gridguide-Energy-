/**
 * POST /api/rewards/catalog/redeem — redeem points for a specific
 * admin-defined catalog item. This is the first real writer to
 * RewardRedemption - that model existed in the schema with a fixed
 * fulfillment-type enum but nothing ever created a row in it before this.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const schema = z.object({ catalogItemId: z.string() });

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const item = await prisma.rewardCatalogItem.findUnique({ where: { id: data.catalogItemId } });
  if (!item || !item.isActive) return err("This item is not available.", 404);

  const reward = await prisma.reward.findUnique({ where: { userId: auth.user.id } });
  if (!reward) return err("Rewards account not found", 404);
  if (reward.points < item.pointsCost) {
    return err(`You need ${item.pointsCost.toLocaleString()} points for this item. You have ${reward.points.toLocaleString()}.`, 400);
  }

  const [, , redemption] = await prisma.$transaction([
    prisma.reward.update({
      where: { id: reward.id },
      data: { points: { decrement: item.pointsCost }, lifetimeRedeemed: { increment: item.pointsCost } },
    }),
    prisma.rewardTransaction.create({
      data: { rewardId: reward.id, points: -item.pointsCost, reason: `Redeemed: ${item.name}`, type: "CATALOG_REDEMPTION", metadata: { catalogItemId: item.id } },
    }),
    prisma.rewardRedemption.create({
      data: {
        userId: auth.user.id, rewardId: reward.id, option: item.fulfillmentType,
        points: item.pointsCost, dollarValue: item.dollarValue,
        rate: item.dollarValue / item.pointsCost, status: "PROCESSING",
      },
    }),
  ]);

  return ok({
    message: `Redeemed "${item.name}" for ${item.pointsCost.toLocaleString()} points.`,
    redemption,
  }, 201);
}
