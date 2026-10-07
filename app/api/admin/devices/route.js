/**
 * GET /api/admin/devices
 * Full device registry for admin — filterable by type, status, VPP eligibility
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const type    = searchParams.get("type")   || "";
  const status  = searchParams.get("status") || "";
  const vpp     = searchParams.get("vpp");           // "true" | "false"
  const search  = searchParams.get("q")      || "";
  const page    = Math.max(1, parseInt(searchParams.get("page")  || "1"));
  const limit   = Math.min(100, parseInt(searchParams.get("limit") || "50"));
  const skip    = (page - 1) * limit;

  const where = {
    ...(type   && { type }),
    ...(status && { status }),
    ...(vpp !== null && vpp !== undefined && { vppEligible: vpp === "true" }),
    ...(search && {
      OR: [
        { manufacturer: { contains: search, mode: "insensitive" } },
        { model:        { contains: search, mode: "insensitive" } },
        { serialNumber: { contains: search, mode: "insensitive" } },
        { user: { name:  { contains: search, mode: "insensitive" } } },
        { user: { email: { contains: search, mode: "insensitive" } } },
      ],
    }),
  };

  const [devices, total, typeCounts, vppCount, onlineCount] = await Promise.all([
    prisma.device.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true, plan: true, homeState: true } },
      },
    }),
    prisma.device.count({ where }),

    // Type breakdown
    prisma.device.groupBy({
      by: ["type"],
      _count: { id: true },
    }),

    // VPP eligible count
    prisma.device.count({ where: { vppEligible: true } }),

    // Online devices
    prisma.device.count({ where: { isOnline: true } }),
  ]);

  const typeBreakdown = Object.fromEntries(
    typeCounts.map(t => [t.type, t._count.id])
  );

  return ok({
    devices,
    total,
    page,
    pages: Math.ceil(total / limit),
    summary: {
      byType:   typeBreakdown,
      vppEligible: vppCount,
      online:      onlineCount,
      offline:     total - onlineCount,
    },
  });
}

export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return err("Device ID required.", 400);

  const body = await request.json().catch(() => ({}));
  const allowed = ["vppEligible", "status", "firmwareVersion", "locationNote"];
  const data = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );

  const device = await prisma.device.update({ where: { id }, data });
  return ok({ device, message: "Device updated." });
}
