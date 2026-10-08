/**
 * Retired legacy endpoint: /api/installer/[...path]
 *
 * This catch-all used to answer every request with a fake success payload
 * (membership "FREE", empty reports, "request received") and no
 * authentication, which made broken front-end calls look like they worked.
 * All installer features now live under /api/installers/*.
 */
import { NextResponse } from "next/server";

function gone(request, { params }) {
  const path = (params?.path || []).join("/");
  return NextResponse.json(
    { ok: false, error: "This endpoint has been retired. Use /api/installers/* instead.", path },
    { status: 410 }
  );
}

export const GET = gone;
export const POST = gone;
export const PATCH = gone;
export const PUT = gone;
export const DELETE = gone;
