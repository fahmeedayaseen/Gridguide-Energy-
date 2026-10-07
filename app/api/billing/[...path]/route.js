import { compatOk, readJson } from "@/app/api/_compat.js";
export async function GET(request, { params }) { return compatOk({ service: "billing", path: params.path || [], data: { portal: true } }); }
export async function POST(request, { params }) { return compatOk({ service: "billing", path: params.path || [], method: "POST", message: "Billing request received. Configure Stripe price IDs before live payments.", data: { received: await readJson(request) } }); }
