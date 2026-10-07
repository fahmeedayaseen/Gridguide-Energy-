import { compatOk } from "@/app/api/_compat.js";
export async function GET() { return compatOk({ service: "memberships", path: ["free"], data: { plan: "HOMEOWNER_FREE", priceMonthly: 0 } }); }
export async function POST() { return compatOk({ service: "memberships", path: ["free"], method: "POST", message: "Free membership selected.", data: { plan: "HOMEOWNER_FREE" } }); }
