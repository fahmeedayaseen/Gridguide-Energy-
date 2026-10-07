/**
 * PATCH  /api/admin/utilities/[id]/incentives/[incentiveId]  — edit a rebate/incentive
 * DELETE /api/admin/utilities/[id]/incentives/[incentiveId]  — remove a rebate/incentive
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const CATEGORY = ["FEDERAL_TAX_CREDIT","STATE_TAX_CREDIT","STATE_REBATE","UTILITY_REBATE","NET_METERING","PROPERTY_TAX","SALES_TAX","EV_REBATE","RENEWABLE_CREDIT"];

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  category: z.enum(CATEGORY).optional(),
  value: z.string().min(1).optional(),
  estimatedDollarValue: z.number().nullable().optional(),
  expiresOn: z.string().datetime().nullable().optional(),
  stackable: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.utilityIncentive.findFirst({ where: { id: params.incentiveId, utilityId: params.id } });
  if (!existing) return err("Incentive not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const incentive = await prisma.utilityIncentive.update({
    where: { id: params.incentiveId },
    data: { ...data, ...(data.expiresOn !== undefined && { expiresOn: data.expiresOn ? new Date(data.expiresOn) : null }) },
  });
  return ok({ incentive, message: "Incentive updated." });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.utilityIncentive.findFirst({ where: { id: params.incentiveId, utilityId: params.id } });
  if (!existing) return err("Incentive not found", 404);

  await prisma.utilityIncentive.delete({ where: { id: params.incentiveId } });
  return ok({ message: "Incentive removed." });
}
