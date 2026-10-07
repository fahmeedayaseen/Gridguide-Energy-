import { prisma } from "@/lib/db.js"; import { ok, err, parseBody } from "@/lib/auth.js"; import { requireRole } from "@/lib/jwt.js"; import { z } from "zod";
const resolveSchema = z.object({ action: z.enum(["approve","reject"]), reason: z.string().min(1), referralId: z.string() });
export async function GET(request) {
  const auth = await requireRole(request, "ADMIN"); if (auth.error) return err(auth.error, auth.status);
  const disputes = await prisma.installerReferral.findMany({ where:{ verified:false, conversionStatus:{ not:"churned" } }, orderBy:{referredAt:"desc"}, take:100, include:{ installer:{select:{companyName:true}}, user:{select:{name:true,email:true}} } });
  return ok({ disputes });
}
export async function POST(request) {
  const auth = await requireRole(request, "ADMIN"); if (auth.error) return err(auth.error, auth.status);
  const { data, error } = await parseBody(request, resolveSchema); if (error) return err("Validation failed", 400);
  const ref = await prisma.installerReferral.findUnique({ where:{id:data.referralId} }); if(!ref) return err("Referral not found",404);
  const updated = await prisma.installerReferral.update({ where:{id:data.referralId}, data:{ verified: data.action==="approve", conversionStatus: data.action==="reject"?"churned":ref.conversionStatus } });
  await prisma.platformAuditLog.create({ data:{ actorUserId:auth.user.id, actorRole:"ADMIN", action:`REFERRAL_DISPUTE_${data.action.toUpperCase()}`, targetType:"InstallerReferral", targetId:ref.id, category:"REFERRAL", metadata:{reason:data.reason,action:data.action} } }).catch(()=>{});
  return ok({ message:`Referral ${data.action}d`, referral:updated });
}
