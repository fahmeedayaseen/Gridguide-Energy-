/**
 * GET  /api/email/unsubscribe/[token] — render confirmation
 * POST /api/email/unsubscribe/[token] — process unsubscribe
 */
import { NextResponse }      from "next/server";
import { ok, err }           from "@/lib/auth.js";
import { processUnsubscribe } from "@/lib/suppression.js";
import { prisma }            from "@/lib/db.js";

export async function GET(request, { params }) {
  const record = await prisma.unsubscribeToken.findUnique({ where: { token: params.token } });
  if (!record) return NextResponse.redirect(new URL("/", request.url));
  // In production this renders an HTML unsubscribe confirmation page.
  // For now return JSON that the unsubscribe page JSX can consume.
  return ok({ email: record.email, used: !!record.usedAt });
}

export async function POST(request, { params }) {
  const result = await processUnsubscribe(params.token);
  if (result.error) return err(result.error, 400);
  return ok({ message: `${result.email} has been unsubscribed from marketing emails.` });
}
