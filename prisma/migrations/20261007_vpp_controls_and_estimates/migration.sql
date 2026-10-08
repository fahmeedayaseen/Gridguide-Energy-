-- VPP provider controls, opt-out sync states, verified earnings estimates,
-- and partner webhook de-duplication.

-- Providers start hidden and closed; an admin opens them explicitly.
ALTER TABLE "vpp_providers" ADD COLUMN IF NOT EXISTS "publicVisible"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vpp_providers" ADD COLUMN IF NOT EXISTS "enrollmentOpen" BOOLEAN NOT NULL DEFAULT false;
-- Preserve today's behavior for providers that are already live (ACTIVE or
-- SANDBOX): keep them visible and open. EnergyHub stays hidden and closed.
UPDATE "vpp_providers" SET "publicVisible" = true, "enrollmentOpen" = true
  WHERE "status" IN ('ACTIVE', 'SANDBOX') AND "key" <> 'energyhub';

ALTER TYPE "VppEnrollmentStatus" ADD VALUE IF NOT EXISTS 'CANCELLATION_PENDING';
ALTER TYPE "VppEnrollmentStatus" ADD VALUE IF NOT EXISTS 'CANCELLATION_FAILED';

CREATE TABLE IF NOT EXISTS "vpp_program_earnings_estimates" (
  "id"             TEXT NOT NULL,
  "programId"      TEXT NOT NULL,
  "lowAmount"      DOUBLE PRECISION NOT NULL,
  "highAmount"     DOUBLE PRECISION NOT NULL,
  "period"         TEXT NOT NULL,
  "deviceType"     TEXT,
  "sourceVerified" BOOLEAN NOT NULL DEFAULT false,
  "sourceName"     TEXT NOT NULL,
  "sourceUrl"      TEXT,
  "notes"          TEXT,
  "validFrom"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo"        TIMESTAMP(3),
  "publishedById"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vpp_program_earnings_estimates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vpp_program_earnings_estimates_programId_fkey" FOREIGN KEY ("programId")
    REFERENCES "vpp_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "vpp_program_earnings_estimates_programId_idx" ON "vpp_program_earnings_estimates"("programId");

-- Before adding the unique constraint, drop exact duplicate partner deliveries
-- (keep the earliest row per providerId + externalId).
DELETE FROM "vpp_provider_webhooks" a
  USING "vpp_provider_webhooks" b
  WHERE a."externalId" IS NOT NULL
    AND a."providerId" = b."providerId" AND a."externalId" = b."externalId"
    AND a."receivedAt" > b."receivedAt";
CREATE UNIQUE INDEX IF NOT EXISTS "vpp_provider_webhooks_providerId_externalId_key"
  ON "vpp_provider_webhooks"("providerId", "externalId");
