import { err } from "@/lib/auth.js";

// Deprecated unconditionally (no feature flag) — this route never did anything
// real; it was a compat stub that echoed back whatever was POSTed. The real
// enrollment endpoint is POST/GET /api/vpp/enrollments (plural), which is
// backed by VppProgramEnrollment and actually talks to VPP partners.
const DEPRECATION_MESSAGE =
  "This endpoint is deprecated and was never functionally wired to VPP enrollment. " +
  "Use /api/vpp/enrollments (plural) instead.";

export async function POST() { return err(DEPRECATION_MESSAGE, 410); }
export async function GET() { return err(DEPRECATION_MESSAGE, 410); }
