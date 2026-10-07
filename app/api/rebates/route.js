import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { cacheGet, cacheSet } from "@/lib/redis.js";
import { z } from "zod";

// Static rebate programs database (in production, use UtilityAPI or DSIRE)
const REBATE_PROGRAMS = [
  {
    id: "ira-itc-2024",
    name: "Federal Solar Tax Credit (ITC)",
    type: "federal",
    amount: null,
    pct: 0.30,
    description: "30% federal tax credit on solar installation costs through 2032.",
    eligibility: ["Solar PV systems", "Battery storage if paired with solar", "No income limit"],
    maxAmount: null,
    expiresAt: "2032-12-31",
    category: "SOLAR",
    states: ["all"],
  },
  {
    id: "ira-battery-2024",
    name: "Home Battery Storage Credit",
    type: "federal",
    amount: null,
    pct: 0.30,
    description: "30% tax credit for standalone battery storage (3kWh+). No solar required after Aug 2022.",
    eligibility: ["Residential battery systems", "Min 3 kWh capacity"],
    maxAmount: null,
    expiresAt: "2032-12-31",
    category: "BATTERY",
    states: ["all"],
  },
  {
    id: "ira-ev-charger",
    name: "EV Charger Tax Credit",
    type: "federal",
    amount: null,
    pct: 0.30,
    description: "30% credit on EV charger purchase and installation. Max $1,000 for residential.",
    eligibility: ["Level 2 EV chargers", "Must be in low-income or rural area after 2023"],
    maxAmount: 1000,
    expiresAt: "2032-12-31",
    category: "EV_CHARGING",
    states: ["all"],
  },
  {
    id: "ca-sgip",
    name: "California SGIP Battery Rebate",
    type: "state",
    amount: null,
    pct: null,
    description: "Self-Generation Incentive Program pays up to $200–$1,000/kWh for battery storage.",
    eligibility: ["CA residents", "PG&E, SCE, SDG&E, SoCalGas customers", "Income-based tiers"],
    maxAmount: 1000,
    expiresAt: null,
    category: "BATTERY",
    states: ["CA"],
  },
  {
    id: "ca-tech-clean",
    name: "California Clean Vehicle Rebate",
    type: "state",
    amount: 4500,
    pct: null,
    description: "Up to $4,500 rebate on new EV purchase. Higher amounts for income-eligible households.",
    eligibility: ["CA residents", "New EV purchase", "Income under $150k single / $204k joint"],
    maxAmount: 7500,
    expiresAt: null,
    category: "EV_CHARGING",
    states: ["CA"],
  },
  {
    id: "pge-ev-rebate",
    name: "PG&E EV Rate Rebate",
    type: "utility",
    amount: 800,
    pct: null,
    description: "PG&E offers $800 rebate for EV charger installation on EV2-A rate.",
    eligibility: ["PG&E residential customers", "New EV charger installation"],
    maxAmount: 800,
    expiresAt: null,
    category: "EV_CHARGING",
    states: ["CA"],
  },
];

const claimSchema = z.object({
  programId:   z.string(),
  productType: z.string(),
  zipCode:     z.string().regex(/^\d{5}$/),
  amount:      z.number().positive(),
  documents:   z.array(z.string()).default([]),
  notes:       z.string().optional(),
});

// GET /api/rebates?zip=94105&category=SOLAR — lookup available rebates by zip/category
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const zip      = searchParams.get("zip") || "";
  const category = searchParams.get("category") || "";

  // State lookup by zip (simplified — in production use zip-to-state lookup)
  const STATE_BY_ZIP = {
    "9": "CA", "8": "TX", "7": "TX", "3": "FL", "6": "IL",
  };
  const state = STATE_BY_ZIP[zip[0]] || null;

  const cacheKey = `rebates:${zip}:${category}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return ok(cached);

  const programs = REBATE_PROGRAMS.filter((p) => {
    const matchesState = p.states.includes("all") || (state && p.states.includes(state));
    const matchesCategory = !category || p.category === category;
    return matchesState && matchesCategory;
  });

  // Estimate savings
  const totalEstimate = programs.reduce((sum, p) => {
    if (p.amount) return sum + p.amount;
    if (p.pct && p.maxAmount) return sum + p.maxAmount;
    return sum;
  }, 0);

  const result = { programs, totalEstimate, state, zip };
  await cacheSet(cacheKey, result, 3600); // 1 hour cache

  return ok(result);
}

// POST /api/rebates — submit rebate claim
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, claimSchema);
  if (error) return err("Validation failed", 400, error);

  const program = REBATE_PROGRAMS.find((p) => p.id === data.programId);
  if (!program) return err("Rebate program not found", 404);

  // Check for duplicate claim
  const existing = await prisma.rebateClaim.findFirst({
    where: {
      userId:      auth.user.id,
      programName: program.name,
      status:      { not: "REJECTED" },
    },
  });
  if (existing) return err("You have already submitted a claim for this program.", 409);

  const claim = await prisma.rebateClaim.create({
    data: {
      userId:      auth.user.id,
      programName: program.name,
      amount:      data.amount,
      productType: data.productType,
      zipCode:     data.zipCode,
      status:      "PENDING",
      documents:   data.documents,
      notes:       data.notes,
    },
  });

  // Award bonus reward points for rebate claim submission
  await prisma.reward.update({
    where: { userId: auth.user.id },
    data: { points: { increment: 50 } },
  });

  return ok({
    claim,
    message: "Rebate claim submitted. GridGuide will review and confirm eligibility within 3-5 business days.",
  }, 201);
}
