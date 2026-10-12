-- GridGuide Business / Enterprise Portal
-- Migration: 20260630_enterprise_portal

-- ── EnterpriseRequest: "Request Access" form submissions ───────────────────────
CREATE TABLE "EnterpriseRequest" (
    "id"            TEXT NOT NULL,
    "orgName"       TEXT NOT NULL,
    "contactName"   TEXT NOT NULL,
    "email"         TEXT NOT NULL,
    "phone"         TEXT,
    "propertyCount" INTEGER,
    "orgType"       TEXT NOT NULL DEFAULT 'Property Management',
    "status"        TEXT NOT NULL DEFAULT 'pending',
    "notes"         TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt"    TIMESTAMP(3),
    "reviewedBy"    TEXT,
    CONSTRAINT "EnterpriseRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseRequest_status_idx" ON "EnterpriseRequest"("status");
CREATE INDEX "EnterpriseRequest_email_idx"  ON "EnterpriseRequest"("email");

-- ── EnterpriseOrg: the organization/account itself ──────────────────────────────
CREATE TABLE "EnterpriseOrg" (
    "id"                    TEXT NOT NULL,
    "name"                  TEXT NOT NULL,
    "plan"                  TEXT NOT NULL DEFAULT 'BUSINESS',
    "contactName"           TEXT NOT NULL,
    "contactEmail"          TEXT NOT NULL,
    "contactPhone"          TEXT,
    "ownerUserId"           TEXT,
    "stripeCustomerId"      TEXT,
    "stripeSubscriptionId"  TEXT,
    "subscriptionStatus"    TEXT,
    "whiteLabelEnabled"     BOOLEAN NOT NULL DEFAULT false,
    "apiEnabled"            BOOLEAN NOT NULL DEFAULT false,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnterpriseOrg_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnterpriseOrg_contactEmail_key" ON "EnterpriseOrg"("contactEmail");
CREATE UNIQUE INDEX "EnterpriseOrg_ownerUserId_key"  ON "EnterpriseOrg"("ownerUserId");
CREATE INDEX "EnterpriseOrg_plan_idx" ON "EnterpriseOrg"("plan");
ALTER TABLE "EnterpriseOrg" ADD CONSTRAINT "EnterpriseOrg_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── EnterpriseProperty: each property in an org's portfolio ─────────────────────
CREATE TABLE "EnterpriseProperty" (
    "id"                TEXT NOT NULL,
    "orgId"             TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "address"           TEXT,
    "type"              TEXT NOT NULL DEFAULT 'Residential',
    "units"             INTEGER NOT NULL DEFAULT 0,
    "kw"                DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status"            TEXT NOT NULL DEFAULT 'pending',
    "utilityAccountId"  TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnterpriseProperty_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseProperty_orgId_idx"  ON "EnterpriseProperty"("orgId");
CREATE INDEX "EnterpriseProperty_status_idx" ON "EnterpriseProperty"("status");
ALTER TABLE "EnterpriseProperty" ADD CONSTRAINT "EnterpriseProperty_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EnterpriseTeamMember: per-org user permissions ───────────────────────────────
CREATE TABLE "EnterpriseTeamMember" (
    "id"          TEXT NOT NULL,
    "orgId"       TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "role"        TEXT NOT NULL DEFAULT 'Manager',
    "department"  TEXT,
    "invitedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt"  TIMESTAMP(3),
    CONSTRAINT "EnterpriseTeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnterpriseTeamMember_orgId_email_key" ON "EnterpriseTeamMember"("orgId", "email");
CREATE INDEX "EnterpriseTeamMember_orgId_idx" ON "EnterpriseTeamMember"("orgId");
ALTER TABLE "EnterpriseTeamMember" ADD CONSTRAINT "EnterpriseTeamMember_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EnterpriseApiKey: API access (Enterprise plan only) ─────────────────────────
CREATE TABLE "EnterpriseApiKey" (
    "id"          TEXT NOT NULL,
    "orgId"       TEXT NOT NULL,
    "keyPrefix"   TEXT NOT NULL,
    "keyHash"     TEXT NOT NULL,
    "label"       TEXT,
    "lastUsedAt"  TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt"   TIMESTAMP(3),
    CONSTRAINT "EnterpriseApiKey_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseApiKey_orgId_idx" ON "EnterpriseApiKey"("orgId");
ALTER TABLE "EnterpriseApiKey" ADD CONSTRAINT "EnterpriseApiKey_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EnterpriseAuditLog: admin actions within an org ──────────────────────────────
CREATE TABLE "EnterpriseAuditLog" (
    "id"          TEXT NOT NULL,
    "orgId"       TEXT NOT NULL,
    "userId"      TEXT,
    "action"      TEXT NOT NULL,
    "metadata"    JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnterpriseAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseAuditLog_orgId_idx"     ON "EnterpriseAuditLog"("orgId");
CREATE INDEX "EnterpriseAuditLog_createdAt_idx" ON "EnterpriseAuditLog"("createdAt");
ALTER TABLE "EnterpriseAuditLog" ADD CONSTRAINT "EnterpriseAuditLog_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EnterpriseProperty ↔ Device link (devices belong to a property) ─────────────
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "enterprisePropertyId" TEXT;
CREATE INDEX IF NOT EXISTS "Device_enterprisePropertyId_idx" ON "Device"("enterprisePropertyId");
ALTER TABLE "Device" ADD CONSTRAINT "Device_enterprisePropertyId_fkey"
    FOREIGN KEY ("enterprisePropertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
