-- Configurable VPP revenue-split rules, replacing hardcoded percentages.

CREATE TABLE IF NOT EXISTS "VppRevenueRule" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "vppProgram"      TEXT,
  "utility"         TEXT,
  "enterpriseOrgId" TEXT,
  "installerId"     TEXT,
  "homeownerPct"    DOUBLE PRECISION NOT NULL,
  "gridguidePct"    DOUBLE PRECISION NOT NULL,
  "partnerPct"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "priority"        INTEGER NOT NULL DEFAULT 0,
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VppRevenueRule_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "VppRevenueRule" ADD CONSTRAINT "VppRevenueRule_enterpriseOrgId_fkey"
    FOREIGN KEY ("enterpriseOrgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "VppRevenueRule" ADD CONSTRAINT "VppRevenueRule_installerId_fkey"
    FOREIGN KEY ("installerId") REFERENCES "Installer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "VppRevenueRule_enterpriseOrgId_idx" ON "VppRevenueRule"("enterpriseOrgId");
CREATE INDEX IF NOT EXISTS "VppRevenueRule_installerId_idx" ON "VppRevenueRule"("installerId");
CREATE INDEX IF NOT EXISTS "VppRevenueRule_vppProgram_idx" ON "VppRevenueRule"("vppProgram");
CREATE INDEX IF NOT EXISTS "VppRevenueRule_utility_idx" ON "VppRevenueRule"("utility");
