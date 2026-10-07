/**
 * PATCH /api/users/me/utility
 * Called immediately after signup to persist the utility the homeowner
 * selected during onboarding. Without this, the selection was stored only
 * in local React state and lost when the dashboard mounted — requiring the
 * homeowner to reconnect their utility in the back-office again.
 *
 * Body: { utilityProvider: string, utilityConnected: boolean }
 */
import { prisma }              from "@/lib/db.js";
import { ok, err, parseBody }  from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z }                   from "zod";

const schema = z.object({
  utilityProvider:  z.string().min(1).max(200),
  utilityConnected: z.boolean().default(true),
});

export async function PATCH(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, schema);
  if (error) return err("Validation failed", 400, error);

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: {
      utilityProvider:  data.utilityProvider,
      utilityConnected: data.utilityConnected,
    },
    select: { id: true, utilityProvider: true, utilityConnected: true },
  });

  return ok({
    message: "Utility selection saved.",
    utilityProvider:  user.utilityProvider,
    utilityConnected: user.utilityConnected,
  });
}
