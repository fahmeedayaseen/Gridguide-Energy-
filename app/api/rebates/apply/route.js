/**
 * POST /api/rebates/apply
 *
 * Submit one or more rebate applications.
 * GridGuide pre-fills all form data from the user's account.
 * Handles:
 *   - Single rebate application (body.programId)
 *   - Bulk apply all eligible programs (body.bulk: true)
 *
 * Body:
 *   {
 *     programId?:   string          // single program ID
 *     bulk?:        boolean         // apply all eligible at once
 *     form: {
 *       name:        string,         // full legal name
 *       phone:       string,
 *       installer:   string,         // installing company name
 *       installDate: string,         // ISO date
 *       systemKw:    number,         // system size in kW
 *     }
 *   }
 *
 * GET /api/rebates/apply — application history
 */

import { prisma } from "@/lib/db.js";
import { ok, err, parseBody } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { redis } from "@/lib/redis.js";
import { logger } from "@/lib/sentry.js";
import { awardPoints } from "@/lib/rewards-engine.js";
import { z } from "zod";

// Rebate program master list — mirrors the GET /api/rebates static list
const REBATE_PROGRAMS = [
  { id: "ira-itc-2024",   name: "Federal Solar Tax Credit (ITC)",     type: "federal", category: "SOLAR",      states: ["all"],         estimatedAmount: null, pct: 0.30 },
  { id: "ira-battery-2024",name: "Home Battery Storage Credit",        type: "federal", category: "BATTERY",    states: ["all"],         estimatedAmount: null, pct: 0.30 },
  { id: "ira-ev-charger", name: "EV Charger Tax Credit",               type: "federal", category: "EV_CHARGING",states: ["all"],         estimatedAmount: 1000, pct: 0.30 },
  { id: "ca-sgip",        name: "California SGIP Battery Rebate",      type: "state",   category: "BATTERY",    states: ["CA"],          estimatedAmount: 2000, pct: null  },
  { id: "ca-tech-clean",  name: "California Clean Vehicle Rebate",     type: "state",   category: "EV_CHARGING",states: ["CA"],          estimatedAmount: 4500, pct: null  },
  { id: "pge-ev-rebate",  name: "PG&E EV Rate Rebate",                 type: "utility", category: "EV_CHARGING",states: ["CA"],          estimatedAmount: 800,  pct: null  },
  { id: "in-net-metering",name: "Indiana Net Metering",                type: "state",   category: "SOLAR",      states: ["IN"],          estimatedAmount: 600,  pct: null  },
  { id: "in-sales-tax",   name: "Indiana Solar Sales Tax Exemption",   type: "state",   category: "SOLAR",      states: ["IN"],          estimatedAmount: 750,  pct: null  },
  { id: "duke-ac-cycling",name: "Duke Energy AC Cycling Rebate",       type: "utility", category: "THERMOSTAT", states: ["IN","NC","FL"], estimatedAmount: 40,   pct: null  },
  { id: "ny-solar-credit",name: "NY State Solar Tax Credit",           type: "state",   category: "SOLAR",      states: ["NY"],          estimatedAmount: 5000, pct: 0.25  },
  { id: "xcel-solar-rewards",name: "Xcel Solar*Rewards",               type: "utility", category: "SOLAR",      states: ["MN","CO"],     estimatedAmount: 1200, pct: null  },
];

const formSchema = z.object({
  name:        z.string().min(2),
  phone:       z.string().optional(),
  installer:   z.string().optional(),
  installDate: z.string().optional(),
  systemKw:    z.union([z.string(), z.number()]).transform(v => parseFloat(v) || 0).optional(),
});

const applySchema = z.object({
  programId: z.string().optional(),
  bulk:      z.boolean().optional().default(false),
  form:      formSchema,
});

// ── POST — submit application(s) ─────────────────────────────────────────────
export async function POST(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const { data, error } = await parseBody(request, applySchema);
  if (error) return err("Validation failed", 400, error);

  const { programId, bulk, form } = data;

  if (!programId && !bulk) {
    return err("Provide programId for single application, or bulk:true for all eligible.", 400);
  }

  // Rate limit: max 10 applications per hour
  const rateKey = `rebate-apply:${auth.user.id}`;
  const count   = await redis.incr(rateKey);
  if (count === 1) await redis.expire(rateKey, 3600);
  if (count > 10)  return err("Too many applications submitted. Please wait an hour.", 429);

  // Get the latest verified address to validate state/utility eligibility
  const address = await prisma.addressVerification.findFirst({
    where:   { userId: auth.user.id },
    orderBy: { verifiedAt: "desc" },
  });

  const userState = address?.state || "";

  // Determine which programs to apply for
  let programs = [];
  if (bulk) {
    // All eligible programs for user's state
    programs = REBATE_PROGRAMS.filter(p =>
      p.states.includes("all") || (userState && p.states.includes(userState))
    );
    if (!programs.length) {
      return err("No eligible rebate programs found for your location.", 404);
    }
  } else {
    const prog = REBATE_PROGRAMS.find(p => p.id === programId);
    if (!prog) return err(`Rebate program not found: ${programId}`, 404);
    programs = [prog];
  }

  const submitted = [];
  const skipped   = [];
  const errors    = [];

  for (const program of programs) {
    try {
      // Check for duplicate claim
      const existing = await prisma.rebateClaim.findFirst({
        where: {
          userId:      auth.user.id,
          programName: program.name,
          status:      { notIn: ["REJECTED", "EXPIRED"] },
        },
      });

      if (existing) {
        skipped.push({ program: program.name, reason: "Already applied", status: existing.status });
        continue;
      }

      // Estimate amount based on system size
      let estimatedAmount = program.estimatedAmount || 0;
      if (program.pct && form.systemKw) {
        const systemCost = (form.systemKw || 8) * 2800; // ~$2,800/kW
        estimatedAmount  = Math.min(systemCost * program.pct, program.estimatedAmount || 999999);
      }

      const claim = await prisma.rebateClaim.create({
        data: {
          userId:          auth.user.id,
          programId:       program.id,
          programName:     program.name,
          programType:     program.type,
          category:        program.category,
          amount:          estimatedAmount,
          status:          "PENDING",
          applicantName:   form.name,
          applicantPhone:  form.phone,
          installerName:   form.installer,
          installDate:     form.installDate ? new Date(form.installDate) : null,
          systemKw:        form.systemKw || null,
          submittedAt:     new Date(),
          notes: `Applied via GridGuide dashboard. System: ${form.systemKw || "N/A"} kW, Installed: ${form.installDate || "N/A"}`,
        },
      });

      // Points awarded per the admin-configurable "REBATE_APPLIED" PointRule
      // (defaults to 50, was previously hardcoded here)
      await awardPoints(auth.user.id, "REBATE_APPLIED", { rebateId: claim.id });

      submitted.push({
        claimId:     claim.id,
        program:     program.name,
        type:        program.type,
        amount:      estimatedAmount,
        status:      "PENDING",
      });

    } catch (e) {
      errors.push({ program: program.name, error: e.message });
      logger.error(`Rebate claim failed: ${program.name}`, { userId: auth.user.id, error: e.message });
    }
  }

  logger.info(`Rebate applications submitted`, {
    userId:    auth.user.id,
    submitted: submitted.length,
    skipped:   skipped.length,
    errors:    errors.length,
    bulk,
  });

  const totalEstimated = submitted.reduce((s, c) => s + (c.amount || 0), 0);
  const bonusPoints    = submitted.length * 50;

  return ok({
    submitted,
    skipped,
    errors:  errors.length ? errors : undefined,
    summary: {
      totalApplications:   submitted.length,
      totalEstimatedValue: totalEstimated,
      bonusPointsEarned:   bonusPoints,
      processingTime:      "4–8 weeks",
    },
    message: submitted.length === 1
      ? `Application for ${submitted[0].program} ($${submitted[0].amount.toLocaleString()}) submitted. Processing takes 4–8 weeks.`
      : `${submitted.length} rebate applications submitted. Estimated value: $${totalEstimated.toLocaleString()}. Processing takes 4–8 weeks.`,
  }, 201);
}

// ── GET — application history ──────────────────────────────────────────────────
export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const claims = await prisma.rebateClaim.findMany({
    where:   { userId: auth.user.id },
    orderBy: { createdAt: "desc" },
    take:    50,
  });

  const summary = {
    total:    claims.length,
    pending:  claims.filter(c => c.status === "PENDING").length,
    approved: claims.filter(c => c.status === "APPROVED").length,
    claimed:  claims.filter(c => c.status === "CLAIMED").length,
    rejected: claims.filter(c => c.status === "REJECTED").length,
    totalValue: claims
      .filter(c => ["APPROVED","CLAIMED"].includes(c.status))
      .reduce((s, c) => s + (c.amount || 0), 0),
  };

  return ok({ claims, summary });
}
