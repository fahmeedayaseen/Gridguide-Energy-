import { prisma } from "@/lib/db.js"; import { ok, err } from "@/lib/auth.js"; import { requireRole } from "@/lib/jwt.js";
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN"); if (auth.error) return err(auth.error, auth.status);
  const { searchParams } = new URL(request.url); const type = searchParams.get("type")||"installer";
  if (type==="installer") {
    const campaigns = await prisma.installerCampaign.findMany({ orderBy:{createdAt:"desc"}, take:200, include:{installer:{select:{companyName:true}},_count:{select:{invites:true}}} });
    return ok({ campaigns });
  }
  const campaigns = await prisma.enterpriseCampaign.findMany({ orderBy:{createdAt:"desc"}, take:200, include:{org:{select:{name:true}},_count:{select:{invites:true}}} });
  return ok({ campaigns });
}
