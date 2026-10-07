import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const updateUserSchema = z.object({
  plan:          z.enum(["HOMEOWNER_FREE","HOMEOWNER_PLUS","HOMEOWNER_PREMIUM"]).optional(),
  role:          z.enum(["CONSUMER","INSTALLER","SELLER","ADMIN"]).optional(),
  emailVerified: z.boolean().optional(),
  suspended:     z.boolean().optional(), // sets role to null / flags account
}).strict();

// GET /api/admin/users
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") || "";
  const role   = searchParams.get("role") || "";
  const plan   = searchParams.get("plan") || "";
  const page   = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") || "50"));
  const skip   = (page - 1) * limit;

  const where = {
    ...(role && { role }),
    ...(plan && { plan }),
    ...(search && {
      OR: [
        { name:  { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true, role: true,
        plan: true, emailVerified: true, createdAt: true,
        _count: { select: { orders: true, devices: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return ok({ users, total, page, pages: Math.ceil(total / limit) });
}

// PATCH /api/admin/users?id=
export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("id");
  if (!userId) return err("User ID required", 400);

  const { data, error } = await parseBody(request, updateUserSchema);
  if (error) return err("Validation failed", 400, error);

  // Prevent admin from demoting themselves
  if (userId === auth.user.id && data.role && data.role !== "ADMIN") {
    return err("Cannot change your own admin role", 403);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, name: true, email: true, role: true, plan: true },
  });

  return ok({ user, message: "User updated." });
}
