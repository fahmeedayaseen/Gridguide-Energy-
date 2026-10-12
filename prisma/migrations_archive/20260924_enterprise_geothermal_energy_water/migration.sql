-- Enterprise geothermal, PPA, and data-center energy/water intelligence.

CREATE TABLE "EnterpriseEnergyAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "provider" TEXT,
    "externalId" TEXT,
    "ratedCapacityKw" DOUBLE PRECISION,
    "thermalCapacityKwh" DOUBLE PRECISION,
    "coolingType" TEXT,
    "waterSource" TEXT,
    "commercialOperationAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseEnergyAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnterpriseGeothermalPpa" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT,
    "assetId" TEXT,
    "name" TEXT NOT NULL,
    "seller" TEXT NOT NULL,
    "utility" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "contractedMw" DOUBLE PRECISION NOT NULL,
    "termYears" INTEGER NOT NULL,
    "capacityFactorPct" DOUBLE PRECISION NOT NULL DEFAULT 90,
    "pricePerMwh" DOUBLE PRECISION,
    "annualEscalationPct" DOUBLE PRECISION,
    "signedAt" TIMESTAMP(3),
    "deliveryStartAt" TIMESTAMP(3),
    "deliveryEndAt" TIMESTAMP(3),
    "regulatoryApproval" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseGeothermalPpa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EnterpriseSustainabilityReading" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "assetId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "facilityEnergyKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "itEnergyKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "geothermalDeliveredKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gridEnergyKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coolingEnergyKwh" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waterWithdrawnGallons" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waterConsumedGallons" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "baselineWaterConsumedGallons" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "waterRecycledGallons" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "carbonAvoidedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnterpriseSustainabilityReading_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EnterpriseEnergyAsset_orgId_externalId_key" ON "EnterpriseEnergyAsset"("orgId", "externalId");
CREATE INDEX "EnterpriseEnergyAsset_orgId_idx" ON "EnterpriseEnergyAsset"("orgId");
CREATE INDEX "EnterpriseEnergyAsset_propertyId_idx" ON "EnterpriseEnergyAsset"("propertyId");
CREATE INDEX "EnterpriseEnergyAsset_type_idx" ON "EnterpriseEnergyAsset"("type");
CREATE INDEX "EnterpriseEnergyAsset_status_idx" ON "EnterpriseEnergyAsset"("status");

CREATE INDEX "EnterpriseGeothermalPpa_orgId_idx" ON "EnterpriseGeothermalPpa"("orgId");
CREATE INDEX "EnterpriseGeothermalPpa_propertyId_idx" ON "EnterpriseGeothermalPpa"("propertyId");
CREATE INDEX "EnterpriseGeothermalPpa_assetId_idx" ON "EnterpriseGeothermalPpa"("assetId");
CREATE INDEX "EnterpriseGeothermalPpa_status_idx" ON "EnterpriseGeothermalPpa"("status");

CREATE UNIQUE INDEX "EnterpriseSustainabilityReading_orgId_source_externalId_key" ON "EnterpriseSustainabilityReading"("orgId", "source", "externalId");
CREATE INDEX "EnterpriseSustainabilityReading_orgId_recordedAt_idx" ON "EnterpriseSustainabilityReading"("orgId", "recordedAt");
CREATE INDEX "EnterpriseSustainabilityReading_propertyId_recordedAt_idx" ON "EnterpriseSustainabilityReading"("propertyId", "recordedAt");
CREATE INDEX "EnterpriseSustainabilityReading_assetId_recordedAt_idx" ON "EnterpriseSustainabilityReading"("assetId", "recordedAt");

ALTER TABLE "EnterpriseEnergyAsset" ADD CONSTRAINT "EnterpriseEnergyAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseEnergyAsset" ADD CONSTRAINT "EnterpriseEnergyAsset_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EnterpriseGeothermalPpa" ADD CONSTRAINT "EnterpriseGeothermalPpa_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseGeothermalPpa" ADD CONSTRAINT "EnterpriseGeothermalPpa_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EnterpriseGeothermalPpa" ADD CONSTRAINT "EnterpriseGeothermalPpa_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseEnergyAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EnterpriseSustainabilityReading" ADD CONSTRAINT "EnterpriseSustainabilityReading_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSustainabilityReading" ADD CONSTRAINT "EnterpriseSustainabilityReading_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseSustainabilityReading" ADD CONSTRAINT "EnterpriseSustainabilityReading_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseEnergyAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
