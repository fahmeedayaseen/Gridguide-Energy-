/**
 * GridGuide Python Microservice Client
 * Calls the FastAPI service from Next.js API routes.
 *
 * Usage:
 *   import py from "@/lib/python-client";
 *   const forecast = await py.solar.forecast({ lat, lng, system_kw: 7.6 });
 *   const payouts  = await py.vpp.calculatePayouts({ event_id, utility_payment, participants });
 */

const PYTHON_URL  = process.env.PYTHON_SERVICE_URL || "http://localhost:8001";
const SECRET      = process.env.INTERNAL_API_SECRET || "";

// ─── Core fetch ───────────────────────────────────────────────────────────────
async function pyFetch(method, path, body = null) {
  const url = `${PYTHON_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type":     "application/json",
      "X-Internal-Secret": SECRET,
    },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000), // 30s timeout for ML calls
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Python service error ${res.status}`);
  }
  return res.json();
}

const get  = (path)       => pyFetch("GET",  path);
const post = (path, body) => pyFetch("POST", path, body);

// ─── Solar ────────────────────────────────────────────────────────────────────
export const solar = {
  forecast: (params) => post("/solar/forecast", params),
  performance: (params) => post("/solar/performance", params),
};

// ─── Grid ─────────────────────────────────────────────────────────────────────
export const grid = {
  status:         (utility) => get(`/grid/status?utility=${encodeURIComponent(utility)}`),
  lmp:            (utility, period = "latest") => get(`/grid/lmp?utility=${encodeURIComponent(utility)}&period=${period}`),
  demandResponse: (utility) => get(`/grid/demand-response?utility=${encodeURIComponent(utility)}`),
};

// ─── VPP ─────────────────────────────────────────────────────────────────────
export const vpp = {
  calculatePayouts:   (data) => post("/vpp/calculate-payouts", data),
  optimizeDispatch:   (data) => post("/vpp/optimize-dispatch", data),
  predictEarnings:    (params) => get(`/vpp/predict-earnings?${new URLSearchParams(params)}`),
};

// ─── Thermostat ───────────────────────────────────────────────────────────────
export const thermostat = {
  optimize:         (data) => post("/thermostat/optimize", data),
  optimizeSchedule: (data) => post("/thermostat/optimize-schedule", data),
};

// ─── Geo ──────────────────────────────────────────────────────────────────────
export const geo = {
  detectUtility:      (lat, lng) => get(`/geo/utility?lat=${lat}&lng=${lng}`),
  detectUtilityBatch: (locations) => post("/geo/utility/batch", { locations }),
};

// ─── Analytics ────────────────────────────────────────────────────────────────
export const analytics = {
  usagePatterns: (data) => post("/analytics/usage-patterns", data),
  savings:       (data) => post("/analytics/savings", data),
};

// ─── Forecast ────────────────────────────────────────────────────────────────
export const forecast = {
  demand:    (data)    => post("/forecast/demand", data),
  vppEvents: (utility, days = 7) => get(`/forecast/vpp-events?utility=${encodeURIComponent(utility)}&days_ahead=${days}`),
};

// ─── Health check ─────────────────────────────────────────────────────────────
export const health = () => get("/health");

const py = { solar, grid, vpp, thermostat, geo, analytics, forecast, health };
export default py;
