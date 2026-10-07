import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { z } from "zod";

const scheduleSchema = z.object({
  slots: z.array(z.object({
    id:     z.string(),
    label:  z.string(),
    time:   z.string().regex(/^\d{1,2}:\d{2} (AM|PM)$/),
    temp:   z.number().min(60).max(90),
    active: z.boolean(),
  })).min(1).max(8),
});

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const thermostat = await prisma.thermostat.findUnique({
    where:  { userId: auth.user.id },
    select: { id: true, schedule: true },
  });
  if (!thermostat) return err("No thermostat connected", 404);

  return ok({ schedule: thermostat.schedule || [] });
}

export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, scheduleSchema);
  if (error) return err("Validation failed", 400, error);

  const thermostat = await prisma.thermostat.update({
    where: { userId: auth.user.id },
    data:  { schedule: data.slots },
  });

  return ok({ schedule: thermostat.schedule, message: "Schedule saved." });
}
