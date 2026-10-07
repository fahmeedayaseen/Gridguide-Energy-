const GALLONS_TO_LITERS = 3.785411784;
const HOURS_PER_YEAR = 8760;

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const rounded = (value, digits = 2) => Number(n(value).toFixed(digits));

export function estimatePpaValue(ppa) {
  if (ppa?.pricePerMwh === null || ppa?.pricePerMwh === undefined) return null;
  const annualMwh = n(ppa.contractedMw) * HOURS_PER_YEAR * (n(ppa.capacityFactorPct || 90) / 100);
  const firstYearRevenue = annualMwh * n(ppa.pricePerMwh);
  const termYears = Math.max(0, Math.trunc(n(ppa.termYears)));
  const escalation = n(ppa.annualEscalationPct) / 100;
  let total = 0;
  for (let year = 0; year < termYears; year += 1) total += firstYearRevenue * ((1 + escalation) ** year);
  return { annualMwh: rounded(annualMwh), firstYearRevenue: rounded(firstYearRevenue), estimatedContractValue: rounded(total) };
}

export function calculateEnergyWaterMetrics(readings = []) {
  const totals = readings.reduce((sum, row) => {
    for (const key of Object.keys(sum)) sum[key] += n(row[key]);
    return sum;
  }, {
    facilityEnergyKwh: 0,
    itEnergyKwh: 0,
    geothermalDeliveredKwh: 0,
    gridEnergyKwh: 0,
    coolingEnergyKwh: 0,
    waterWithdrawnGallons: 0,
    waterConsumedGallons: 0,
    baselineWaterConsumedGallons: 0,
    waterRecycledGallons: 0,
    carbonAvoidedKg: 0,
  });

  const pue = totals.itEnergyKwh > 0 ? totals.facilityEnergyKwh / totals.itEnergyKwh : null;
  const wueLitersPerItKwh = totals.itEnergyKwh > 0
    ? (totals.waterConsumedGallons * GALLONS_TO_LITERS) / totals.itEnergyKwh
    : null;
  const geothermalCoveragePct = totals.facilityEnergyKwh > 0
    ? Math.min(100, (totals.geothermalDeliveredKwh / totals.facilityEnergyKwh) * 100)
    : null;
  const coolingSharePct = totals.facilityEnergyKwh > 0
    ? Math.min(100, (totals.coolingEnergyKwh / totals.facilityEnergyKwh) * 100)
    : null;
  // Recycled Water Share (%): share of total water supplied (new withdrawals + recycled)
  // that came from recycled water. Withdrawn must exclude recycled volumes, and both
  // volumes must cover the same reporting period. Null (shown as "No data") when the
  // denominator is zero.
  const recycledWaterSharePct = (totals.waterWithdrawnGallons + totals.waterRecycledGallons) > 0
    ? (totals.waterRecycledGallons / (totals.waterWithdrawnGallons + totals.waterRecycledGallons)) * 100
    : null;
  const waterSavedGallons = Math.max(0, totals.baselineWaterConsumedGallons - totals.waterConsumedGallons);

  return {
    readingCount: readings.length,
    totals: { ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, rounded(value)])), waterSavedGallons: rounded(waterSavedGallons) },
    efficiency: {
      pue: pue === null ? null : rounded(pue, 3),
      wueLitersPerItKwh: wueLitersPerItKwh === null ? null : rounded(wueLitersPerItKwh, 3),
      geothermalCoveragePct: geothermalCoveragePct === null ? null : rounded(geothermalCoveragePct, 1),
      coolingSharePct: coolingSharePct === null ? null : rounded(coolingSharePct, 1),
      recycledWaterSharePct: recycledWaterSharePct === null ? null : rounded(recycledWaterSharePct, 1),
    },
  };
}

export function buildDailyTrend(readings = []) {
  const days = new Map();
  for (const reading of readings) {
    const day = new Date(reading.recordedAt).toISOString().slice(0, 10);
    const current = days.get(day) || [];
    current.push(reading);
    days.set(day, current);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => ({
    date,
    ...calculateEnergyWaterMetrics(rows),
  }));
}
