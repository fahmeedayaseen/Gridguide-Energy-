-- Water balance v2 + meter hierarchy (review handoff, Oct 12 2026)

-- Readings: separate imported reclaimed water from on-site recycling; storage change; meter link
ALTER TABLE "EnterpriseSustainabilityReading"
    ADD COLUMN "waterReclaimedImportedGallons" DOUBLE PRECISION,
    ADD COLUMN "waterStorageChangeGallons" DOUBLE PRECISION,
    ADD COLUMN "meterId" TEXT;

-- Contracts: where the terms come from
ALTER TABLE "EnterpriseGeothermalPpa" ADD COLUMN "evidenceReference" TEXT;

-- Meters
CREATE TABLE "EnterpriseMeter" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "meterLevel" TEXT NOT NULL,
    "parentMeterId" TEXT,
    "coveragePct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "intervalMinutes" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "settlementPriority" INTEGER,
    "preferredSettlement" BOOLEAN NOT NULL DEFAULT false,
    "utilityMeterNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnterpriseMeter_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseMeter_orgId_idx" ON "EnterpriseMeter"("orgId");
CREATE INDEX "EnterpriseMeter_propertyId_idx" ON "EnterpriseMeter"("propertyId");
CREATE INDEX "EnterpriseMeter_parentMeterId_idx" ON "EnterpriseMeter"("parentMeterId");
ALTER TABLE "EnterpriseMeter" ADD CONSTRAINT "EnterpriseMeter_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseMeter" ADD CONSTRAINT "EnterpriseMeter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseMeter" ADD CONSTRAINT "EnterpriseMeter_parentMeterId_fkey" FOREIGN KEY ("parentMeterId") REFERENCES "EnterpriseMeter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "EnterpriseSustainabilityReading_meterId_recordedAt_idx" ON "EnterpriseSustainabilityReading"("meterId", "recordedAt");
ALTER TABLE "EnterpriseSustainabilityReading" ADD CONSTRAINT "EnterpriseSustainabilityReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "EnterpriseMeter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
