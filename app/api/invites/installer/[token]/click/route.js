/**
 * GET /api/invites/installer/[token]/click
 * Pixel/redirect endpoint — records clickedAt and redirects to the landing page.
 * Used in invitation emails: href="/api/invites/installer/[token]/click"
 * which records the click then redirects to /join/[code]/[token]
 */
import { prisma }  from "@/lib/db.js";
import { NextResponse } from "next/server";

export async function GET(request, { params }) {
  const invite = await prisma.installerCustomerInvite.findUnique({
    where: { inviteToken: params.token },
    include: { installer: { select: { referralCode: true } } },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

  if (!invite || ["SIGNED_UP","SUBSCRIBED","DECLINED"].includes(invite.status)) {
    return NextResponse.redirect(`${baseUrl}/platform`);
  }

  // Record click — idempotent
  if (!invite.clickedAt) {
    await prisma.installerCustomerInvite.update({
      where: { id: invite.id },
      data:  { clickedAt: new Date(), status: "CLICKED" },
    }).catch(() => {});

    if (invite.campaignId) {
      await prisma.installerCampaign.update({
        where: { id: invite.campaignId },
        data:  { clickCount: { increment: 1 } },
      }).catch(() => {});
    }
  }

  const code = invite.installer?.referralCode || invite.installerId;
  return NextResponse.redirect(`${baseUrl}/join/${code}/${invite.inviteToken}`);
}
