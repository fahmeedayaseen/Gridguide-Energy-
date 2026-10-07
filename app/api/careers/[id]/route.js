/**
 * PATCH /api/careers/[id] — admin updates application status or notes
 * DELETE /api/careers/[id] — admin deletes application
 */
import { prisma }             from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole }        from "@/lib/jwt.js";
import { z }                  from "zod";

const updateSchema = z.object({
  status: z.enum(["NEW","REVIEWING","INTERVIEW","OFFER","REJECTED","WITHDRAWN"]).optional(),
  notes:  z.string().max(2000).optional(),
});

export async function PATCH(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, updateSchema);
  if (error) return err("Validation failed", 400, error);

  const application = await prisma.jobApplication.update({
    where: { id: params.id },
    data,
  });

  return ok({ application });
}

export async function DELETE(request, { params }) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  await prisma.jobApplication.delete({ where: { id: params.id } });
  return ok({ deleted: true });
}
