-- Admin Partner Invitation System
-- Creates PartnerInvitation table for admin-led onboarding of
-- installer companies, enterprise organizations, and seller companies.
-- Does NOT touch InstallerCustomerInvite, EnterpriseHomeownerInvite, or SellerTeamInvite.

CREATE TYPE "PartnerInvitationType"   AS ENUM ('INSTALLER','ENTERPRISE','SELLER');
CREATE TYPE "PartnerInvitationStatus" AS ENUM (
  'DRAFT','SENT','OPENED','ACCEPTED','EXPIRED','CANCELLED','APPROVED','REJECTED'
);

CREATE TABLE "PartnerInvitation" (
  "id"                     TEXT                      NOT NULL,
  "type"                   "PartnerInvitationType"   NOT NULL,
  "status"                 "PartnerInvitationStatus" NOT NULL DEFAULT 'DRAFT',
  "email"                  TEXT                      NOT NULL,
  "contactName"            TEXT,
  "companyName"            TEXT                      NOT NULL,
  "phone"                  TEXT,
  "website"                TEXT,
  "assignedPlan"           TEXT,
  "commissionRate"         DOUBLE PRECISION,
  "successFeeRate"         DOUBLE PRECISION,
  "subscriptionShare"      DOUBLE PRECISION,
  "vppInstallerShare"      DOUBLE PRECISION,
  "marketplaceCategory"    TEXT,
  "shippingRequired"       BOOLEAN  NOT NULL DEFAULT false,
  "stripeConnectRequired"  BOOLEAN  NOT NULL DEFAULT true,
  "taxInfoRequired"        BOOLEAN  NOT NULL DEFAULT true,
  "sellerAgreementVersion" TEXT,
  "expectedPropertyCount"  INTEGER,
  "sponsoredHomeowners"    BOOLEAN  NOT NULL DEFAULT false,
  "serviceStates"          TEXT[]   NOT NULL DEFAULT ARRAY[]::TEXT[],
  "licenseRequired"        BOOLEAN  NOT NULL DEFAULT true,
  "token"                  TEXT     NOT NULL,
  "expiresAt"              TIMESTAMP(3) NOT NULL,
  "sentAt"                 TIMESTAMP(3),
  "openedAt"               TIMESTAMP(3),
  "acceptedAt"             TIMESTAMP(3),
  "approvedAt"             TIMESTAMP(3),
  "rejectedAt"             TIMESTAMP(3),
  "cancelledAt"            TIMESTAMP(3),
  "resendCount"            INTEGER  NOT NULL DEFAULT 0,
  "lastSentAt"             TIMESTAMP(3),
  "lastSendError"          TEXT,
  "invitedByUserId"        TEXT     NOT NULL,
  "acceptedByUserId"       TEXT,
  "approvedByUserId"       TEXT,
  "installerId"            TEXT,
  "enterpriseOrgId"        TEXT,
  "sellerId"               TEXT,
  "internalNote"           TEXT,
  "metadata"               JSONB,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartnerInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerInvitation_token_key"          ON "PartnerInvitation"("token");
CREATE INDEX        "PartnerInvitation_type_status_idx"    ON "PartnerInvitation"("type","status");
CREATE INDEX        "PartnerInvitation_email_idx"          ON "PartnerInvitation"("email");
CREATE INDEX        "PartnerInvitation_companyName_idx"    ON "PartnerInvitation"("companyName");
CREATE INDEX        "PartnerInvitation_expiresAt_idx"      ON "PartnerInvitation"("expiresAt");
CREATE INDEX        "PartnerInvitation_invitedByUserId_idx" ON "PartnerInvitation"("invitedByUserId");
