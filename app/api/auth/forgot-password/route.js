import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { rateLimit, redis } from "@/lib/redis.js";
import { sendPasswordResetEmail } from "@/lib/email.js";
import { hashPassword } from "@/lib/auth.js";
import { z } from "zod";
import { v4 as uuid } from "uuid";

// POST /api/auth/forgot-password
export async function POST(request) {
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const { allowed } = await rateLimit(`pwd-reset:${ip}`, 3, 3600);
  if (!allowed) return err("Too many requests. Try again in an hour.", 429);

  const { data, error } = await parseBody(request, z.object({ email: z.string().email() }));
  if (error) return err("Invalid email", 400);

  const user = await prisma.user.findUnique({ where: { email: data.email } });

  // Always return success — don't reveal if email exists
  if (!user) return ok({ message: "If that email exists, a reset link has been sent." });

  const token  = uuid();
  const expiry = 3600; // 1 hour

  await redis.setEx(`pwd-reset:${token}`, expiry, user.id);
  await sendPasswordResetEmail(user, token);

  return ok({ message: "If that email exists, a reset link has been sent." });
}
