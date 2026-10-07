import { compatOk, readJson } from "@/app/api/_compat.js";
export async function GET() { return compatOk({ service: "devices", path: ["thermostat"], data: { controlEndpoint: "/api/thermostat/control", scheduleEndpoint: "/api/thermostat/schedule" } }); }
export async function POST(request) { return compatOk({ service: "devices", path: ["thermostat"], method: "POST", data: { received: await readJson(request) } }); }
