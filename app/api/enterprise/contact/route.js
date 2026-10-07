import { compatOk, readJson } from "@/app/api/_compat.js";
export async function POST(request) { return compatOk({ service: "enterprise", path: ["contact"], method: "POST", message: "Enterprise contact request received.", data: { received: await readJson(request) } }); }
export async function GET() { return compatOk({ service: "enterprise", path: ["contact"], data: { email: "enterprise@gridguide.ai" } }); }
