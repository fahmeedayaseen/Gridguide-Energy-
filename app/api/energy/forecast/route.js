import { compatOk, readJson } from "@/app/api/_compat.js";
export async function GET() { return compatOk({ service: "energy", path: ["forecast"], data: { pythonService: process.env.PYTHON_SERVICE_URL || "http://localhost:8001" } }); }
export async function POST(request) { return compatOk({ service: "energy", path: ["forecast"], method: "POST", message: "Energy forecast request received; connect Python service for live ML output.", data: { received: await readJson(request) } }); }
