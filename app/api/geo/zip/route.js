import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { lookupZip } from "@/lib/geo.js";
import { prisma } from "@/lib/db.js";
import { z } from "zod";

// GET /api/geo/zip?zip=78701
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const zip = searchParams.get("zip");
  if (!zip || !/^\d{5}$/.test(zip)) return err("Valid 5-digit ZIP required", 400);

  const result = await lookupZip(zip);
  if (!result) return err(`ZIP code ${zip} not found`, 404);

  return ok({ zip: result });
}

// POST /api/geo/zip — Admin: bulk seed ZIP codes from CSV data
export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, z.object({
    zips: z.array(z.object({
      zip:      z.string().length(5),
      city:     z.string(),
      state:    z.string().length(2),
      lat:      z.number(),
      lng:      z.number(),
      county:   z.string().optional(),
      timezone: z.string().optional(),
    })),
  }));
  if (error) return err("Validation failed", 400, error);

  let created = 0, updated = 0;

  for (const zipData of data.zips) {
    const existing = await prisma.zipCode.findUnique({ where: { zip: zipData.zip } });
    if (existing) {
      await prisma.zipCode.update({ where: { zip: zipData.zip }, data: zipData });
      updated++;
    } else {
      await prisma.zipCode.create({ data: zipData });
      created++;
    }
  }

  return ok({ created, updated, total: data.zips.length });
}
