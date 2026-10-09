/**
 * Partner Invitation Approval Service
 *
 * Called by PATCH /api/admin/partner-invitations/[id] with action=APPROVE.
 * Runs in a single Prisma transaction:
 *   1. Creates or links the correct partner record (Installer / Seller / EnterpriseOrg)
 *   2. Updates PartnerInvitation to APPROVED and stores the linked record ID
 *   3. Writes audit log
 *
 * Safety note: acceptance ≠ activation. Marketplace listings, VPP, and payouts
 * must not be enabled here. Those require separate Stripe Connect, tax, license,
 * and business-review gates before activation.
 */

import { prisma } from "@/lib/db.js";
import { getInstallerSuccessFeeRate } from "./platform-config.js";

export async function approveAcceptedPartnerInvitation(invitation, adminUserId) {
  if (invitation.status !== "ACCEPTED" || !invitation.acceptedByUserId) {
    throw new Error("Invitation must be in ACCEPTED status with a linked user before approval");
  }

  return prisma.$transaction(async (tx) => {
    let target;

    // ── INSTALLER ────────────────────────────────────────────────────────────
    if (invitation.type === "INSTALLER") {
      target = await tx.installer.upsert({
        where:  { userId: invitation.acceptedByUserId },
        update: {
          companyName:        invitation.companyName,
          plan:               (invitation.assignedPlan || "FREE"),
          verificationStatus: "PENDING",
          ...(invitation.successFeeRate   != null && { successFeeRate: invitation.successFeeRate }),
          ...(invitation.subscriptionShare != null && { revenueSharePct: invitation.subscriptionShare }),
        },
        create: {
          userId:             invitation.acceptedByUserId,
          companyName:        invitation.companyName,
          licenseNumber:      "PENDING_VERIFICATION",
          plan:               (invitation.assignedPlan || "FREE"),
          verificationStatus: "PENDING",
          successFeeRate:     invitation.successFeeRate   ?? await getInstallerSuccessFeeRate(invitation.assignedPlan || "FREE"),
          revenueSharePct:    invitation.subscriptionShare ?? 0.15,
          serviceAreas:       invitation.serviceStates ?? [],
          specialties:        [],
          territories:        [],
        },
      });

    // ── SELLER ───────────────────────────────────────────────────────────────
    } else if (invitation.type === "SELLER") {
      target = await tx.seller.upsert({
        where:  { userId: invitation.acceptedByUserId },
        update: {
          businessName:       invitation.companyName,
          category:           invitation.marketplaceCategory || "OTHER",
          plan:               (invitation.assignedPlan || "FREE"),
          commissionRate:     invitation.commissionRate ?? 0.10,
          verificationStatus: "PENDING",
          // NOTE: products remain inactive until a separate activation gate
        },
        create: {
          userId:             invitation.acceptedByUserId,
          businessName:       invitation.companyName,
          category:           invitation.marketplaceCategory || "OTHER",
          plan:               (invitation.assignedPlan || "FREE"),
          commissionRate:     invitation.commissionRate ?? 0.10,
          verificationStatus: "PENDING",
        },
      });

    // ── ENTERPRISE ───────────────────────────────────────────────────────────
    } else if (invitation.type === "ENTERPRISE") {
      // Look up the accepted user's email — EnterpriseOrg.contactEmail is unique
      const acceptedUser = await tx.user.findUnique({
        where:  { id: invitation.acceptedByUserId },
        select: { email: true, name: true },
      });
      if (!acceptedUser) throw new Error("Accepted user not found");

      target = await tx.enterpriseOrg.upsert({
        where:  { contactEmail: acceptedUser.email },
        update: {
          name:         invitation.companyName,
          contactName:  invitation.contactName || acceptedUser.name,
          ownerUserId:  invitation.acceptedByUserId,
          plan:         invitation.assignedPlan || "ENTERPRISE_BASIC",
          sponsoredSeatLimit: invitation.sponsoredHomeowners ? (invitation.expectedPropertyCount ?? 0) : 0,
        },
        create: {
          name:          invitation.companyName,
          contactName:   invitation.contactName || acceptedUser.name,
          contactEmail:  acceptedUser.email,
          ownerUserId:   invitation.acceptedByUserId,
          plan:          invitation.assignedPlan || "ENTERPRISE_BASIC",
          sponsoredSeatLimit: invitation.sponsoredHomeowners ? (invitation.expectedPropertyCount ?? 0) : 0,
        },
      });

    } else {
      throw new Error(`Unsupported partner invitation type: ${invitation.type}`);
    }

    // ── Mark APPROVED + link partner record ───────────────────────────────
    const updated = await tx.partnerInvitation.update({
      where: { id: invitation.id },
      data: {
        status:          "APPROVED",
        approvedAt:      new Date(),
        approvedByUserId: adminUserId,
        ...(invitation.type === "INSTALLER"  && { installerId:     target.id }),
        ...(invitation.type === "SELLER"     && { sellerId:        target.id }),
        ...(invitation.type === "ENTERPRISE" && { enterpriseOrgId: target.id }),
      },
    });

    await tx.platformAuditLog.create({
      data: {
        actorUserId: adminUserId,
        actorRole:   "ADMIN",
        action:      "PARTNER_INVITATION_APPROVED",
        targetType:  invitation.type,
        targetId:    target.id,
        category:    "TEAM",
        metadata:    { invitationId: invitation.id, companyName: invitation.companyName },
      },
    });

    return { invitation: updated, target };
  });
}
