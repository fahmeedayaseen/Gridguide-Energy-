/**
 * GET /api/enterprise/carbon — estimated carbon offset from real installed
 * solar capacity.
 *
 * There's no dedicated carbon-tracking model or actual generation telemetry
 * aggregation in this schema. Rather than fabricate a specific-looking
 * number, this computes a standard, clearly-labeled ESTIMATE from real
 * installed capacity data using the EPA's published average grid emissions
 * factor and average US solar capacity factor — the same category of
 * estimate solar installers commonly quote, not a measured figure.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { requireEnterpriseRole } from "@/lib/enterprise-permissions.js";

// EPA eGRID average US grid emissions factor: ~0.386 kg CO2/kWh (2024 data).
// Average US solar capacity factor: ~24% (i.e. a 1kW system produces
// roughly 1 x 0.24 x 8760 = ~2,100 kWh/year).
const GRID_EMISSIONS_KG_PER_KWH = 0.386;
const SOLAR_CAPACITY_FACTOR = 0.24;
const HOURS_PER_YEAR = 8760;

export async function GET(request) {
  const auth = await authenticateRequest(request);
  if (auth.error) return err(auth.error, auth.status);

  const access = await requireEnterpriseRole(auth.user.id, "Viewer");
  if (!access.allowed) return err(access.error, access.status);

  const org = await prisma.enterpriseOrg.findUnique({
    where: { id: access.org.id },
    include: { properties: { select: { id: true, kw: true, name: true } } },
  });
  if (!org) return err("Enterprise organization not found", 404);

  const totalSolarKw = org.properties.reduce((a, p) => a + (p.kw || 0), 0);
  const estimatedAnnualKwh = totalSolarKw * SOLAR_CAPACITY_FACTOR * HOURS_PER_YEAR;
  const estimatedAnnualCo2Kg = estimatedAnnualKwh * GRID_EMISSIONS_KG_PER_KWH;

  return ok({
    estimate: {
      totalSolarKw,
      estimatedAnnualKwh: Math.round(estimatedAnnualKwh),
      estimatedAnnualCo2Kg: Math.round(estimatedAnnualCo2Kg),
      estimatedAnnualCo2Tons: Math.round(estimatedAnnualCo2Kg / 1000 * 10) / 10,
      equivalentTreesPlanted: Math.round(estimatedAnnualCo2Kg / 21), // ~21kg CO2/tree/year, EPA estimate
    },
    methodology: "Estimated from installed solar capacity using EPA's average US grid emissions factor (0.386 kg CO2/kWh) and average US solar capacity factor (24%). This is a standard industry estimate, not measured generation data — this schema doesn't currently track actual production telemetry.",
    perProperty: org.properties.map((p) => ({ name: p.name, kw: p.kw, estimatedAnnualKwh: Math.round((p.kw||0) * SOLAR_CAPACITY_FACTOR * HOURS_PER_YEAR) })),
  });
}
