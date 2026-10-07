import { compatOk, readJson } from "@/app/api/_compat.js";

export async function GET(request, { params }) {
  return compatOk({ service: "seller", path: params.path || [], data: { products: [], orders: [], payouts: [], webhooks: [] } });
}
export async function POST(request, { params }) {
  const body = await readJson(request);
  return compatOk({ service: "seller", path: params.path || [], method: "POST", message: "Seller request received.", data: { received: body } });
}
