/**
 * GET /api/public/proposals/[token] — homeowner view of a sent proposal.
 * Unauthenticated by design (the emailed link is the credential), so it
 * returns only what the homeowner needs and nothing about other leads.
 * Expired or unknown tokens return 404/410.
 */
import { prisma } from "@/lib/db.js";
import { ok, err } from "@/lib/auth.js";

export async function GET(request, { params }) {
  const token = String(params?.token || "");
  if (!/^[a-f0-9]{48}$/.test(token)) return err("Proposal not found", 404);

  const proposal = await prisma.proposal.findUnique({
    where:  { viewToken: token },
    select: {
      title: true, amount: true, notes: true, lineItems: true, status: true,
      validUntil: true, sentAt: true, viewTokenExpiresAt: true,
      lead:      { select: { customerName: true, projectType: true, address: true } },
      installer: { select: { companyName: true, nabcepCertified: true } },
    },
  });
  if (!proposal) return err("Proposal not found", 404);
  if (proposal.viewTokenExpiresAt && proposal.viewTokenExpiresAt < new Date()) {
    return err("This proposal link has expired. Contact your installer for a new one.", 410);
  }

  const { viewTokenExpiresAt, lead, ...rest } = proposal;
  return ok({
    proposal: {
      ...rest,
      expiresAt:    viewTokenExpiresAt,
      customerName: (lead?.customerName || "").split(" ")[0] || null,
      projectType:  lead?.projectType || null,
      address:      lead?.address || null,
    },
  });
}
