/**
 * GET /api/installers/invites — list the installer's pending invites
 * Supports: ?status=PENDING|SENT|OPENED|SIGNED_UP|SUBSCRIBED|DECLINED
 *           ?batchId= filter by import batch
 *           ?campaignId= filter by campaign
 *           ?page=1&limit=100
 */
import { prisma }             from "@/lib/db.js";
import { ok, err }            from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const installer = await prisma.installer.findUnique({ where: { userId: auth.user.id } });
  if (!installer) return err("Installer account not found.", 404);

  const { searchParams } = new URL(request.url);
  const status     = searchParams.get("status");
  const batchId    = searchParams.get("batchId");
  const campaignId = searchParams.get("campaignId");
  const page  = Math.max(1, parseInt(searchParams.get("page")  || "1"));
  const limit = Math.min(200, parseInt(searchParams.get("limit") || "100"));

  const where = {
    installerId: installer.id,
    ...(status     && { status }),
    ...(batchId    && { importBatchId: batchId }),
    ...(campaignId && { campaignId }),
  };

  const [invites, total] = await Promise.all([
    prisma.installerCustomerInvite.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.installerCustomerInvite.count({ where }),
  ]);

  // Funnel summary
  const summary = await prisma.installerCustomerInvite.groupBy({
    by: ["status"],
    where: { installerId: installer.id },
    _count: { id: true },
  });

  return ok({
    invites,
    total,
    page,
    pages: Math.ceil(total / limit),
    funnel: Object.fromEntries(summary.map(s => [s.status, s._count.id])),
  });
}
