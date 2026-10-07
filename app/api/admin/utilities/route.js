/**
 * GET  /api/admin/utilities  — list utilities (Utility Intelligence Module, Phase 3)
 * POST /api/admin/utilities  — add a new utility
 */
import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { requireRole } from "@/lib/jwt.js";
import { z } from "zod";

const connectionTypeEnum = z.enum([
  "MANUAL","GREEN_BUTTON","DERAPI","UTILITY_API","CSV_UPLOAD","BAYOU","ARCADIA",
  "BILL_UPLOAD","TESLA","ENPHASE","SOLAREDGE","SPAN","EMPORIA","SMARTTHINGS","AMAZON_ALEXA",
]);

const createSchema = z.object({
  name: z.string().min(2),
  shortName: z.string().min(1),
  state: z.string().length(2),
  eiaid: z.string().optional(),
  type: z.string().default("IOU"),
  iso: z.string().optional(),
  website: z.string().url().optional(),
  customerPortalUrl: z.string().url().optional(),
  phone: z.string().optional(),
  supportsGreenButton: z.boolean().optional().default(false),
  supportsArcadia: z.boolean().optional().default(false),
  supportsDirectApi: z.boolean().optional().default(false),
  supportsManualUpload: z.boolean().optional().default(true),
  preferredConnectionMethod: connectionTypeEnum.optional(),
  greenButtonAuthUrl: z.string().url().optional(),
  arcadiaUtilityId: z.string().optional(),
  directApiProvider: z.string().optional(),
  directApiBaseUrl: z.string().url().optional(),
  vppEligible: z.boolean().optional().default(false),
  netMeteringAvailable: z.boolean().optional().default(false),
  touRatesAvailable: z.boolean().optional().default(false),
  demandResponseAvailable: z.boolean().optional().default(false),
  minLat: z.number().optional(),
  maxLat: z.number().optional(),
  minLng: z.number().optional(),
  maxLng: z.number().optional(),
  notes: z.string().optional(),
}).strict();

export async function GET(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { searchParams } = new URL(request.url);
  const state  = (searchParams.get("state") || "").toUpperCase();
  const active = searchParams.get("active"); // "true" | "false" | absent = all
  const search = searchParams.get("search") || "";
  const page   = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit  = Math.min(100, parseInt(searchParams.get("limit") || "50"));
  const skip   = (page - 1) * limit;

  const where = {
    ...(state && { state }),
    ...(active === "true" && { isActive: true }),
    ...(active === "false" && { isActive: false }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { shortName: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [utilities, total, stateBreakdown, greenButtonCount, arcadiaCount, directApiCount] = await Promise.all([
    prisma.utilityTerritory.findMany({
      where, skip, take: limit,
      orderBy: [{ state: "asc" }, { shortName: "asc" }],
      include: { _count: { select: { programs: true, incentives: true, ratePlans: true, connectionEvents: true } } },
    }),
    prisma.utilityTerritory.count({ where }),
    prisma.utilityTerritory.groupBy({ by: ["state"], _count: { id: true }, where: { isActive: true } }),
    prisma.utilityTerritory.count({ where: { isActive: true, supportsGreenButton: true } }),
    prisma.utilityTerritory.count({ where: { isActive: true, supportsArcadia: true } }),
    prisma.utilityTerritory.count({ where: { isActive: true, supportsDirectApi: true } }),
  ]);

  return ok({
    utilities, total, page, limit, pages: Math.ceil(total / limit),
    coverage: {
      statesLoaded: stateBreakdown.length,
      byState: stateBreakdown.map((s) => ({ state: s.state, count: s._count.id })),
      connectionMethods: { greenButton: greenButtonCount, arcadia: arcadiaCount, directApi: directApiCount },
    },
  });
}

export async function POST(request) {
  const auth = await requireRole(request, "ADMIN");
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, createSchema);
  if (error) return err("Validation failed", 400, error);

  if (data.eiaid) {
    const existing = await prisma.utilityTerritory.findUnique({ where: { eiaid: data.eiaid } });
    if (existing) return err("A utility with this EIA ID already exists.", 409);
  }

  const utility = await prisma.utilityTerritory.create({ data });
  return ok({ utility, message: "Utility added." }, 201);
}
