/**
 * GET /api/invites/homeowner/[token]/click
 * Enterprise homeowner invite click tracking — records click, redirects to landing page.
 * Used in enterprise invitation emails so click engagement is tracked.
 */
import { prisma }       from "@/lib/db.js";
import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

  const invite = await prisma.enterpriseHomeownerInvite.findUnique({
    where: { token: params.token },
  });

  if (!invite || ["SIGNED_UP","SUBSCRIBED","DECLINED","EXPIRED"].includes(invite.status)) {
    return NextResponse.redirect(new URL("/platform", request.url));
  }

  // Idempotent — only record first click
  if (!invite.clickedAt) {
    await prisma.$transaction(async tx => {
      await tx.enterpriseHomeownerInvite.update({
        where: { id: invite.id },
        data:  {
          clickedAt: new Date(),
          status: invite.status === "OPENED" || invite.status === "SENT" || invite.status === "PENDING"
            ? "CLICKED" : invite.status,
        },
      });
      if (invite.campaignId) {
        await tx.enterpriseCampaign.update({
          where: { id: invite.campaignId },
          data:  { clickCount: { increment: 1 } },
        });
      }
    }).catch(() => {});
  }

  return NextResponse.redirect(
    new URL(`/invite/homeowner/${invite.token}`, request.url)
  );
}
