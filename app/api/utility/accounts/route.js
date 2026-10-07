import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { assertLimit } from "@/lib/memberships.js";
import { getEffectivePlanForUser } from "@/lib/effective-plan.js";
import { requireOrganizationRole } from "@/lib/enterprise.js";
import { z } from "zod";

const accountSchema = z.object({
  organizationId: z.string().optional(),
  propertyId: z.string().optional(),
  provider: z.string().min(2),
  utilityAccountNumber: z.string().optional(),
  externalAccountId: z.string().optional(),
  connectionType: z.enum([
    "MANUAL","GREEN_BUTTON","DERAPI","UTILITY_API","CSV_UPLOAD","BAYOU","ARCADIA",
    "BILL_UPLOAD","TESLA","ENPHASE","SOLAREDGE","SPAN","EMPORIA","SMARTTHINGS","AMAZON_ALEXA",
  ]).optional().default("MANUAL"),
  tariff: z.string().optional(),
  serviceAddress: z.string().optional(),
  meterNumber: z.string().optional(),
  metadata: z.any().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const where = organizationId
    ? { organizationId, organization: { members: { some: { userId: auth.user.id, status: "ACTIVE" } } } }
    : { userId: auth.user.id };
  const accounts = await prisma.utilityAccount.findMany({ where, orderBy: { createdAt: "desc" } });
  return ok({ accounts });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, accountSchema);
  if (error) return err("Validation failed", 400, error);

  if (data.organizationId) {
    const access = await requireOrganizationRole(auth.user.id, data.organizationId, ["OWNER", "ADMIN", "MANAGER"]);
    if (!access.allowed) return err(access.error, access.status);
  } else {
    const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { plan: true, _count: { select: { utilityAccounts: true } } } });
    const effectivePlan = await getEffectivePlanForUser(auth.user.id);
    const limit = assertLimit(effectivePlan || user?.plan, "utilityConnections", user?._count?.utilityAccounts || 0, "Utility connection");
    if (!limit.allowed) return err(limit.error, limit.status, limit);
  }

  let account;
  try {
    account = await prisma.utilityAccount.create({ data: { userId: auth.user.id, status: "CONNECTED", ...data, lastSyncAt: new Date() } });
  } catch (e) {
    await logConnectionEvent({ userId: auth.user.id, method: data.connectionType, success: false, errorMessage: e.message });
    return err("Could not connect this utility account. Please try again.", 500);
  }

  await logConnectionEvent({ userId: auth.user.id, method: data.connectionType, success: true });
  return ok({ account, message: "Utility account connected." }, 201);
}

// Phase 3 of the Utility Intelligence Module: every connection attempt (success
// or failure) is recorded so the admin portal can monitor success rates per
// utility and per connection method. Best-effort utility resolution via the
// user's saved home state — never blocks or fails the actual connection flow.
async function logConnectionEvent({ userId, method, success, errorMessage }) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { homeState: true, homeZip: true } });
    let utilityId = null;
    if (user?.homeZip) {
      const zipData = await prisma.zipCode.findUnique({ where: { zip: user.homeZip }, select: { utilityId: true } });
      utilityId = zipData?.utilityId || null;
    }
    if (!utilityId && user?.homeState) {
      const utility = await prisma.utilityTerritory.findFirst({ where: { state: user.homeState, isActive: true } });
      utilityId = utility?.id || null;
    }
    await prisma.utilityConnectionEvent.create({
      data: { userId, method, success, errorMessage: errorMessage || null, utilityId },
    });
  } catch {
    // Logging must never break the actual connection flow.
  }
}
