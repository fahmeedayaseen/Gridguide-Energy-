/**
 * GET   /api/admin/enterprise-requests — list all GridGuide Business requests
 * PATCH /api/admin/enterprise-requests — update a request's status (admin only)
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { requireRole }         from "@/lib/jwt.js";
import { z }                   from "zod";

const patchSchema = z.object({
  id:     z.string(),
  status: z.enum(["pending","contacted","approved","rejected"]),
  notes:  z.string().optional(),
});

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const requests = await prisma.enterpriseRequest.findMany({
    where:   status ? { status } : {},
    orderBy: { createdAt: "desc" },
  });

  const counts = await prisma.enterpriseRequest.groupBy({ by: ["status"], _count: true });

  return ok({
    requests,
    counts: Object.fromEntries(counts.map(c => [c.status, c._count])),
  });
}

export async function PATCH(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, patchSchema);
  if (error) return err("Validation failed", 400, error);

  const updated = await prisma.enterpriseRequest.update({
    where: { id: data.id },
    data:  { status: data.status, notes: data.notes, reviewedAt: new Date(), reviewedBy: auth.user.id },
  });

  return ok({ request: updated, message: `Request marked as ${data.status}.` });
}
