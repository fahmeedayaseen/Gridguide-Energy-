import { NextResponse } from "next/server";

export function compatOk({ service, path = [], method = "GET", message, data = {} }) {
  return NextResponse.json({
    ok: true,
    service,
    path,
    method,
    message: message || `${service} endpoint is connected.`,
    data,
  });
}

export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
