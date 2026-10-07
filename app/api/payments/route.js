import { compatOk, readJson } from "@/app/api/_compat.js";
export async function GET() { return compatOk({ service: "payments", data: { payoutsEndpoint: "/api/payments/payouts", withdrawEndpoint: "/api/payments/withdraw", connectEndpoint: "/api/payments/connect" } }); }
export async function POST(request) { return compatOk({ service: "payments", method: "POST", data: { received: await readJson(request) } }); }
