import { ok } from "@/lib/auth.js";
import { publicMembershipPayload } from "@/lib/memberships.js";

// GET /api/memberships — public Free / Pro / Enterprise plan details for frontend pricing pages
export async function GET(request) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return ok({ plans: publicMembershipPayload(baseUrl) });
}
