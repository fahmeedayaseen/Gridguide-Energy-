-- Phases 2, 3, 4, 6, 7: homeowner invitations, sponsorship, installer
-- network, annual billing fields, unified audit log.

-- Found during Phase 4 build: this default was missed in the earlier
-- Plan enum rename sweep.
ALTER TABLE "InstallerReferral" ALTER COLUMN "userPlan" SET DEFAULT 'HOMEOWNER_FREE';
UPDATE "InstallerReferral" SET "userPlan" = 'HOMEOWNER_FREE' WHERE "userPlan" = 'FREE';
UPDATE "InstallerReferral" SET "userPlan" = 'HOMEOWNER_PLUS' WHERE "userPlan" = 'PRO';
UPDATE "InstallerReferral" SET "userPlan" = 'HOMEOWNER_PREMIUM' WHERE "userPlan" = 'ENTERPRISE';

ALTER TABLE "EnterpriseOrg" ADD COLUMN IF NOT EXISTS "sponsoredSeatLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EnterpriseOrg" ADD COLUMN IF NOT EXISTS "sponsorshipStripeSubscriptionId" TEXT;
ALTER TABLE "EnterpriseOrg" ADD COLUMN IF NOT EXISTS "sponsorshipStripeItemId" TEXT;
ALTER TABLE "EnterpriseOrg" ADD COLUMN IF NOT EXISTS "billingCycle" TEXT NOT NULL DEFAULT 'MONTHLY';

CREATE TABLE IF NOT EXISTS "EnterpriseHomeownerInvite" (
  "id" TEXT NOT NULL, "orgId" TEXT NOT NULL, "email" TEXT NOT NULL,
  "homeownerUserId" TEXT,
  "invitedByUserId" TEXT NOT NULL, "invitedViaInstallerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "token" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL, "respondedAt" TIMESTAMP(3),
  CONSTRAINT "EnterpriseHomeownerInvite_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "EnterpriseHomeownerInvite" ADD CONSTRAINT "EnterpriseHomeownerInvite_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EnterpriseHomeownerInvite" ADD CONSTRAINT "EnterpriseHomeownerInvite_invitedViaInstallerId_fkey"
    FOREIGN KEY ("invitedViaInstallerId") REFERENCES "Installer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "EnterpriseHomeownerInvite_token_key" ON "EnterpriseHomeownerInvite"("token");
CREATE INDEX IF NOT EXISTS "EnterpriseHomeownerInvite_orgId_idx" ON "EnterpriseHomeownerInvite"("orgId");
CREATE INDEX IF NOT EXISTS "EnterpriseHomeownerInvite_email_idx" ON "EnterpriseHomeownerInvite"("email");
CREATE INDEX IF NOT EXISTS "EnterpriseHomeownerInvite_homeownerUserId_idx" ON "EnterpriseHomeownerInvite"("homeownerUserId");
CREATE INDEX IF NOT EXISTS "EnterpriseHomeownerInvite_status_idx" ON "EnterpriseHomeownerInvite"("status");

CREATE TABLE IF NOT EXISTS "EnterpriseSponsorship" (
  "id" TEXT NOT NULL, "orgId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "plan" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3), "gracePeriodEndsAt" TIMESTAMP(3),
  CONSTRAINT "EnterpriseSponsorship_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "EnterpriseSponsorship" ADD CONSTRAINT "EnterpriseSponsorship_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EnterpriseSponsorship" ADD CONSTRAINT "EnterpriseSponsorship_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "EnterpriseSponsorship_userId_key" ON "EnterpriseSponsorship"("userId");
CREATE INDEX IF NOT EXISTS "EnterpriseSponsorship_orgId_idx" ON "EnterpriseSponsorship"("orgId");
CREATE INDEX IF NOT EXISTS "EnterpriseSponsorship_status_idx" ON "EnterpriseSponsorship"("status");

CREATE TABLE IF NOT EXISTS "EnterpriseInstallerNetwork" (
  "id" TEXT NOT NULL, "orgId" TEXT NOT NULL, "installerId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'INVITED',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "installerRespondedAt" TIMESTAMP(3), "adminApprovedByUserId" TEXT,
  "adminApprovedAt" TIMESTAMP(3),
  CONSTRAINT "EnterpriseInstallerNetwork_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "EnterpriseInstallerNetwork" ADD CONSTRAINT "EnterpriseInstallerNetwork_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EnterpriseInstallerNetwork" ADD CONSTRAINT "EnterpriseInstallerNetwork_installerId_fkey"
    FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "EnterpriseInstallerNetwork_orgId_installerId_key" ON "EnterpriseInstallerNetwork"("orgId", "installerId");
CREATE INDEX IF NOT EXISTS "EnterpriseInstallerNetwork_orgId_idx" ON "EnterpriseInstallerNetwork"("orgId");
CREATE INDEX IF NOT EXISTS "EnterpriseInstallerNetwork_installerId_idx" ON "EnterpriseInstallerNetwork"("installerId");
CREATE INDEX IF NOT EXISTS "EnterpriseInstallerNetwork_status_idx" ON "EnterpriseInstallerNetwork"("status");

CREATE TABLE IF NOT EXISTS "PlatformAuditLog" (
  "id" TEXT NOT NULL, "actorUserId" TEXT, "actorRole" TEXT, "action" TEXT NOT NULL,
  "targetType" TEXT, "targetId" TEXT, "orgId" TEXT, "category" TEXT NOT NULL,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_orgId_idx" ON "PlatformAuditLog"("orgId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_actorUserId_idx" ON "PlatformAuditLog"("actorUserId");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_createdAt_idx" ON "PlatformAuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_action_idx" ON "PlatformAuditLog"("action");
CREATE INDEX IF NOT EXISTS "PlatformAuditLog_category_idx" ON "PlatformAuditLog"("category");
