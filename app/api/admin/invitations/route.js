/**
 * GET /api/admin/invitations
 * Search and filter across InstallerCustomerInvite and EnterpriseHomeownerInvite.
 * Supports: ?type=installer|enterprise&status=&email=&page=&limit=
 */
import { prisma }      from "@/lib/db.js";
import { ok, err }     from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const type   = searchParams.get("type") || "installer";
  const status = searchParams.get("status");
  const email  = searchParams.get("email");
  const page   = Math.max(1, parseInt(searchParams.get("page")  || "1"));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") || "50"));

  if (type === "installer") {
    const where = {
      ...(status && { status }),
      ...(email  && { email: { contains: email, mode: "insensitive" } }),
    };
    const [invites, total] = await Promise.all([
      prisma.installerCustomerInvite.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit,
        include: { installer: { select: { companyName:true } } },
      }),
      prisma.installerCustomerInvite.count({ where }),
    ]);
    return ok({ invites, total, type });
  }

  const where = {
    ...(status && { status }),
    ...(email  && { email: { contains: email, mode: "insensitive" } }),
  };
  const [invites, total] = await Promise.all([
    prisma.enterpriseHomeownerInvite.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page-1)*limit, take: limit,
      include: { org: { select: { name:true } } },
    }),
    prisma.enterpriseHomeownerInvite.count({ where }),
  ]);
  return ok({ invites, total, type });
}
