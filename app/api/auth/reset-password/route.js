import { prisma } from "@/lib/db.js";
import { ok, err, parseBody, hashPassword } from "@/lib/auth.js";
import { redis } from "@/lib/redis.js";
import { z } from "zod";

export async function POST(request) {
  const { data, error } = await parseBody(request, z.object({
    token:    z.string(),
    password: z.string().min(8).max(100),
  }));
  if (error) return err("Invalid request", 400);

  // Look up token in Redis
  const userId = await redis.get(`pwd-reset:${data.token}`);
  if (!userId) return err("Reset link is invalid or has expired.", 400);

  const passwordHash = await hashPassword(data.password);

  await prisma.user.update({
    where: { id: userId },
    data:  { passwordHash },
  });

  // Invalidate token
  await redis.del(`pwd-reset:${data.token}`);

  return ok({ message: "Password reset successfully. You can now sign in." });
}
