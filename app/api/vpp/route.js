import { compatOk, readJson } from "@/app/api/_compat.js";

// Service-discovery stub. Previously advertised the legacy endpoints
// (/api/vpp/events, /api/vpp/earnings, /api/vpp/payouts) as if they were
// the current system. GridGuide tracks and settles VPP participation
// through partner integrations — these are the real, current endpoints.
export async function GET() {
  return compatOk({
    service: "vpp",
    data: {
      providersEndpoint: "/api/vpp/providers",
      enrollmentsEndpoint: "/api/vpp/enrollments",
      partnerEventsEndpoint: "/api/vpp/events/partner",
      revenueEndpoint: "/api/vpp/revenue",
      webhookEndpoint: "/api/vpp/webhooks/{provider}",
    },
  });
}
export async function POST(request) { return compatOk({ service: "vpp", method: "POST", data: { received: await readJson(request) } }); }
