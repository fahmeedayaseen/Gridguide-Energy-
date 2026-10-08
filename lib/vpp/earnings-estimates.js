/**
 * Public VPP earnings display — the only path by which a VPP dollar figure
 * reaches a homeowner or the public. An estimate is shown only when an admin
 * published it with sourceVerified=true and today is inside its validity
 * window; otherwise the program shows "varies by program".
 */
const PERIOD_LABEL = { per_event: "per event", per_month: "per month", per_season: "per season", per_year: "per year" };

export const VPP_EARNINGS_DISCLAIMER =
  "Estimates are not guaranteed. Actual incentives depend on your utility program, device, and how many events are called.";

export function pickCurrentVerifiedEstimate(estimates = [], now = new Date()) {
  return (estimates || [])
    .filter((e) => e.sourceVerified === true && new Date(e.validFrom) <= now && (!e.validTo || new Date(e.validTo) >= now))
    .sort((a, b) => new Date(b.validFrom) - new Date(a.validFrom))[0] || null;
}

export function getPublicVppEarningsDisplay(estimates, now = new Date()) {
  const e = pickCurrentVerifiedEstimate(estimates, now);
  if (!e) return { available: false, label: "Varies by program", disclaimer: VPP_EARNINGS_DISCLAIMER };
  const fmt = (v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const range = e.lowAmount === e.highAmount ? fmt(e.lowAmount) : `${fmt(e.lowAmount)}–${fmt(e.highAmount)}`;
  return {
    available: true,
    label: `${range} ${PERIOD_LABEL[e.period] || ""}`.trim(),
    low: e.lowAmount, high: e.highAmount, period: e.period, deviceType: e.deviceType || null,
    source: { name: e.sourceName, url: e.sourceUrl || null },
    validTo: e.validTo || null,
    disclaimer: VPP_EARNINGS_DISCLAIMER,
  };
}
