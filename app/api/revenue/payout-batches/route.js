import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const batchSchema = z.object({
  batchType: z.enum(["SELLER", "INSTALLER", "VPP", "REWARDS", "ENTERPRISE_PARTNER"]),
  scheduledFor: z.string().datetime().optional(),
  metadata: z.any().optional(),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  if (auth.user?.role !== "ADMIN") return err("Admin access required", 403);
  const batches = await prisma.payoutBatch.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return ok({ batches });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);
  if (auth.user?.role !== "ADMIN") return err("Admin access required", 403);
  const { data, error } = await parseBody(request, batchSchema);
  if (error) return err("Validation failed", 400, error);

  const batch = await prisma.payoutBatch.create({
    data: {
      batchType: data.batchType,
      scheduledFor: data.scheduledFor ? new Date(data.scheduledFor) : null,
      metadata: data.metadata,
    },
  });
  return ok({ batch, message: "Payout batch created." }, 201);
}
