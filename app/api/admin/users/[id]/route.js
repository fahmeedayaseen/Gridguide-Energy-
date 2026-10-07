/**
 * GET  /api/admin/users/[id]  — full user profile for admin drill-down
 * PATCH /api/admin/users/[id] — update user fields
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const updateSchema = z.object({
  plan:               z.enum(["HOMEOWNER_FREE","HOMEOWNER_PLUS","HOMEOWNER_PREMIUM"]).optional(),
  role:               z.enum(["CONSUMER","INSTALLER","SELLER","ADMIN"]).optional(),
  emailVerified:      z.boolean().optional(),
  onboardingCompleted:z.boolean().optional(),
  utilityConnected:   z.boolean().optional(),
  utilityProvider:    z.string().optional(),
  homeAddress:        z.string().optional(),
  homeState:          z.string().optional(),
  homeZip:            z.string().optional(),
}).strict();

export async function GET(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { id } = params;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      devices:      true,
      thermostat:   { select: { brand: true, model: true, aiOptimize: true } },
      vppEnrollment:{ select: { active: true, enrolledAt: true } },
      vppPayouts:   { orderBy: { createdAt: "desc" }, take: 10 },
      rewards:      { select: { points: true, tier: true, lifetimePoints: true } },
      rebateClaims: { orderBy: { createdAt: "desc" }, take: 5 },
      orders:       { orderBy: { createdAt: "desc" }, take: 10,
                      include: { items: { include: { product: { select: { name: true } } } } } },
      paymentCards: { where: { isActive: true } },
      payoutPreference: true,
      wallet:       { select: { balance: true, lifetimeEarned: true } },
      siteSurveys:  { orderBy: { scheduledAt: "desc" }, take: 5 },
      communityPosts:{ orderBy: { createdAt: "desc" }, take: 5, select: { title: true, tag: true, likes: true, createdAt: true } },
      activityLogs: { orderBy: { createdAt: "desc" }, take: 20 },
      vppEnrollmentLogs: { orderBy: { createdAt: "desc" }, take: 10 },
      _count: {
        select: {
          devices: true, orders: true, aiChats: true,
          rebateClaims: true, communityPosts: true,
        },
      },
    },
  });

  if (!user) return err("User not found.", 404);

  // Remove sensitive fields
  const { passwordHash, ...safeUser } = user;

  return ok({ user: safeUser });
}

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { id } = params;

  if (id === auth.user.id) {
    const body = await request.json().catch(()=>({}));
    if (body.role && body.role !== "ADMIN") return err("Cannot demote your own admin role.", 403);
  }

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed.", 400, error);

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, plan: true,
              onboardingCompleted: true, utilityConnected: true },
  });

  // Log this admin action
  await prisma.userActivityLog.create({
    data: {
      userId: id,
      action: "admin_update",
      metadata: { updatedBy: auth.user.id, fields: Object.keys(data) },
    },
  }).catch(() => {}); // non-blocking

  return ok({ user, message: "User updated." });
}
