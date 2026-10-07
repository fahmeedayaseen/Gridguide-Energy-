/**
 * GET  /api/admin/vpp-revenue-rules — list all rules
 * POST /api/admin/vpp-revenue-rules — create a rule
 *
 * See lib/vpp-revenue-rules.js for how these are resolved at payout time,
 * and ENTERPRISE_ARCHITECTURE_DECISION.md for the broader context this
 * feature was built alongside.
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";
import { z } from "zod";

// VppRevenueRule is only ever read by /api/vpp/payouts (the legacy manual
// batch-payout path for the legacy VppEvent model) — it has no connection
// to the real partner-based settlement path (/api/vpp/revenue, which uses
// installer-plan-tier splits from lib/platform-config.js instead). Gated
// alongside the rest of the legacy dispatch flow.

const pctSum = (data) => Math.abs((data.homeownerPct + data.gridguidePct + (data.partnerPct || 0)) - 1) < 0.0001;

const createSchema = z.object({
  name:            z.string().min(1).max(150),
  vppProgram:      z.string().nullable().optional(),
  utility:         z.string().nullable().optional(),
  enterpriseOrgId: z.string().nullable().optional(),
  installerId:     z.string().nullable().optional(),
  homeownerPct:    z.number().min(0).max(1),
  gridguidePct:    z.number().min(0).max(1),
  partnerPct:      z.number().min(0).max(1).default(0),
  priority:        z.number().int().default(0),
  isActive:        z.boolean().default(true),
}).refine(pctSum, { message: "homeownerPct + gridguidePct + partnerPct must sum to 1.0" });

export async function GET(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const rules = await prisma.vppRevenueRule.findMany({
    orderBy: [{ isActive: "desc" }, { priority: "desc" }, { createdAt: "desc" }],
    include: {
      enterpriseOrg: { select: { name: true } },
      installer: { select: { companyName: true } },
    },
  });
  return ok({ rules });
}

export async function POST(request) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err(error.errors?.[0]?.message || "Validation failed", 400, error);

  if (data.enterpriseOrgId && data.installerId) {
    return err("A rule can be scoped to an enterprise org OR an installer, not both.", 400);
  }

  const rule = await prisma.vppRevenueRule.create({ data: { ...data, createdByUserId: auth.user.id } });
  return ok({ rule, message: "Revenue split rule created." }, 201);
}
