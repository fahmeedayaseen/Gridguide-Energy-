/**
 * GET  /api/admin/utilities/[id]/incentives  — list a utility's rebates/incentives
 * POST /api/admin/utilities/[id]/incentives  — add a rebate/incentive
 *
 * Statewide/federal incentives (not utility-specific) are managed the same way
 * but with utilityId omitted — POST to /api/admin/utilities/incentives/statewide instead.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const CATEGORY = ["FEDERAL_TAX_CREDIT","STATE_TAX_CREDIT","STATE_REBATE","UTILITY_REBATE","NET_METERING","PROPERTY_TAX","SALES_TAX","EV_REBATE","RENEWABLE_CREDIT"];

const createSchema = z.object({
  name: z.string().min(2),
  category: z.enum(CATEGORY),
  value: z.string().min(1),
  estimatedDollarValue: z.number().nullable().optional(),
  expiresOn: z.string().datetime().nullable().optional(),
  stackable: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
}).strict();

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const incentives = await prisma.utilityIncentive.findMany({
    where: { utilityId: params.id },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  return ok({ incentives });
}

export async function POST(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const utility = await prisma.utilityTerritory.findUnique({ where: { id: params.id } });
  if (!utility) return err("Utility not found", 404);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  const incentive = await prisma.utilityIncentive.create({
    data: { ...data, utilityId: params.id, state: utility.state, expiresOn: data.expiresOn ? new Date(data.expiresOn) : null },
  });
  return ok({ incentive, message: "Incentive added." }, 201);
}
