import { compatOk, readJson } from "@/app/api/_compat.js";

export async function GET(request, { params }) {
  return compatOk({ service: "installer", path: params.path || [], data: { membership: "FREE", reports: [], billing: null } });
}
export async function POST(request, { params }) {
  const body = await readJson(request);
  return compatOk({ service: "installer", path: params.path || [], method: "POST", message: "Installer request received.", data: { received: body } });
}
