import { prisma } from "@/lib/db.js";
import { err } from "@/lib/auth.js";
import { authenticateRequest } from "@/lib/jwt.js";
import { createMembershipCheckoutSession, PRICES } from "@/lib/stripe.js";
import { normalizePlan } from "@/lib/memberships.js";

function redirect(url, status = 303) {
  return new Response(null, { status, headers: { Location: url } });
}

async function startCheckout(request) {
  const auth = await authenticateRequest(request);
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  if (auth.error) return redirect(`${origin}/login?next=/membership`);

  const url = new URL(request.url);
  let plan = normalizePlan(url.searchParams.get("plan") || "HOMEOWNER_PLUS");
  if (plan === "HOMEOWNER_FREE") return redirect(`${origin}/membership?plan=HOMEOWNER_FREE`);

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { id: true, email: true, name: true, plan: true, stripeCustomerId: true },
  });
  if (!user) return redirect(`${origin}/login?next=/membership`);

  // Was hardcoded to PRICES.CONSUMER_PRO regardless of the requested plan -
  // an Enterprise checkout would have silently charged the Pro price instead.
  const priceId = plan === "HOMEOWNER_PREMIUM" ? PRICES.CONSUMER_ENTERPRISE : PRICES.CONSUMER_PRO;
  if (!priceId || priceId === "price_...") {
    return redirect(`${origin}/membership?error=missing_stripe_price`);
  }

  const session = await createMembershipCheckoutSession({
    user,
    plan,
    priceId,
    successUrl: `${origin}/membership`,
    cancelUrl: `${origin}/membership`,
  });

  return redirect(session.url);
}

export async function GET(request) {
  return startCheckout(request);
}

export async function POST(request) {
  return startCheckout(request);
}
