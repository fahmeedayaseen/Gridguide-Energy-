import { compatOk, readJson } from "@/app/api/_compat.js";
export async function GET() { return compatOk({ service: "utility", data: { accountsEndpoint: "/api/utility/accounts", ratesEndpoint: "/api/utility/rates", usageEndpoint: "/api/utility/usage" } }); }
export async function POST(request) { return compatOk({ service: "utility", method: "POST", data: { received: await readJson(request) } }); }
