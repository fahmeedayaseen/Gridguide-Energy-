/**
 * PATCH  /api/admin/vpp-revenue-rules/[id] — update a rule
 * DELETE /api/admin/vpp-revenue-rules/[id] — remove a rule
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { legacyVppGateOrNull } from "@/lib/vpp-legacy-gate.js";
import { z } from "zod";

const updateSchema = z.object({
  name:            z.string().min(1).max(150).optional(),
  vppProgram:      z.string().nullable().optional(),
  utility:         z.string().nullable().optional(),
  enterpriseOrgId: z.string().nullable().optional(),
  installerId:     z.string().nullable().optional(),
  homeownerPct:    z.number().min(0).max(1).optional(),
  gridguidePct:    z.number().min(0).max(1).optional(),
  partnerPct:      z.number().min(0).max(1).optional(),
  priority:        z.number().int().optional(),
  isActive:        z.boolean().optional(),
}).strict();

export async function PATCH(request, { params }) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.vppRevenueRule.findUnique({ where: { id: params.id } });
  if (!existing) return err("Rule not found", 404);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const merged = { ...existing, ...data };
  if (Math.abs((merged.homeownerPct + merged.gridguidePct + (merged.partnerPct || 0)) - 1) > 0.0001) {
    return err("homeownerPct + gridguidePct + partnerPct must sum to 1.0", 400);
  }
  if (merged.enterpriseOrgId && merged.installerId) {
    return err("A rule can be scoped to an enterprise org OR an installer, not both.", 400);
  }

  const rule = await prisma.vppRevenueRule.update({ where: { id: params.id }, data });
  return ok({ rule, message: "Rule updated." });
}

export async function DELETE(request, { params }) {
  const gate = legacyVppGateOrNull();
  if (gate) return gate;

  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const existing = await prisma.vppRevenueRule.findUnique({ where: { id: params.id } });
  if (!existing) return err("Rule not found", 404);

  await prisma.vppRevenueRule.delete({ where: { id: params.id } });
  return ok({ message: "Rule removed." });
}
