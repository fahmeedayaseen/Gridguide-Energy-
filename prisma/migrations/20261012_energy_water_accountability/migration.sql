-- Energy & Water accountability platform (Oct 2026): multi-resource supply
-- contracts, microgrid/reserve margin, load ramp, regulatory milestones,
-- customer-vs-ratepayer cost allocation, contract deliveries, water discharge.

-- Readings: water returned to sewer/environment (needed for a verified water balance)
ALTER TABLE "EnterpriseSustainabilityReading" ADD COLUMN "waterDischargedGallons" DOUBLE PRECISION;

-- Properties: planning settings for data centers
ALTER TABLE "EnterpriseProperty"
    ADD COLUMN "requiredReserveMarginPct" DOUBLE PRECISION,
    ADD COLUMN "gridWaterIntensityGalPerMwh" DOUBLE PRECISION,
    ADD COLUMN "gridWaterIntensitySource" TEXT;

-- Assets: private microgrid resources
ALTER TABLE "EnterpriseEnergyAsset"
    ADD COLUMN "microgrid" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "firmCapacityKw" DOUBLE PRECISION;

-- Contracts (formerly geothermal-only PPAs): any resource type
ALTER TABLE "EnterpriseGeothermalPpa"
    ADD COLUMN "resourceType" TEXT NOT NULL DEFAULT 'GEOTHERMAL',
    ADD COLUMN "contractType" TEXT NOT NULL DEFAULT 'PPA',
    ADD COLUMN "contractedAnnualMwh" DOUBLE PRECISION,
    ADD COLUMN "firmCapacityMw" DOUBLE PRECISION,
    ADD COLUMN "waterIntensityGalPerMwh" DOUBLE PRECISION,
    ADD COLUMN "waterIntensitySource" TEXT;
CREATE INDEX "EnterpriseGeothermalPpa_resourceType_idx" ON "EnterpriseGeothermalPpa"("resourceType");

-- Load ramp schedule
CREATE TABLE "EnterpriseLoadRampStep" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "phase" TEXT NOT NULL,
    "plannedLoadMw" DOUBLE PRECISION NOT NULL,
    "plannedPeakMw" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnterpriseLoadRampStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseLoadRampStep_orgId_idx" ON "EnterpriseLoadRampStep"("orgId");
CREATE INDEX "EnterpriseLoadRampStep_propertyId_effectiveDate_idx" ON "EnterpriseLoadRampStep"("propertyId", "effectiveDate");
ALTER TABLE "EnterpriseLoadRampStep" ADD CONSTRAINT "EnterpriseLoadRampStep_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseLoadRampStep" ADD CONSTRAINT "EnterpriseLoadRampStep_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permits & regulatory milestones
CREATE TABLE "EnterpriseRegulatoryMilestone" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT,
    "contractId" TEXT,
    "assetId" TEXT,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agency" TEXT,
    "docketNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "dueDate" TIMESTAMP(3),
    "filedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "referenceUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnterpriseRegulatoryMilestone_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseRegulatoryMilestone_orgId_idx" ON "EnterpriseRegulatoryMilestone"("orgId");
CREATE INDEX "EnterpriseRegulatoryMilestone_propertyId_idx" ON "EnterpriseRegulatoryMilestone"("propertyId");
CREATE INDEX "EnterpriseRegulatoryMilestone_status_idx" ON "EnterpriseRegulatoryMilestone"("status");
CREATE INDEX "EnterpriseRegulatoryMilestone_dueDate_idx" ON "EnterpriseRegulatoryMilestone"("dueDate");
ALTER TABLE "EnterpriseRegulatoryMilestone" ADD CONSTRAINT "EnterpriseRegulatoryMilestone_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseRegulatoryMilestone" ADD CONSTRAINT "EnterpriseRegulatoryMilestone_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EnterpriseRegulatoryMilestone" ADD CONSTRAINT "EnterpriseRegulatoryMilestone_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EnterpriseGeothermalPpa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EnterpriseRegulatoryMilestone" ADD CONSTRAINT "EnterpriseRegulatoryMilestone_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "EnterpriseEnergyAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Customer vs ratepayer cost allocation
CREATE TABLE "EnterpriseCostAllocation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "propertyId" TEXT,
    "contractId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "customerShare" DOUBLE PRECISION NOT NULL,
    "ratepayerShare" DOUBLE PRECISION NOT NULL,
    "otherShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "basis" TEXT NOT NULL DEFAULT 'CONTRACT',
    "status" TEXT NOT NULL DEFAULT 'ESTIMATED',
    "sourceReference" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnterpriseCostAllocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseCostAllocation_orgId_idx" ON "EnterpriseCostAllocation"("orgId");
CREATE INDEX "EnterpriseCostAllocation_propertyId_idx" ON "EnterpriseCostAllocation"("propertyId");
CREATE INDEX "EnterpriseCostAllocation_contractId_idx" ON "EnterpriseCostAllocation"("contractId");
ALTER TABLE "EnterpriseCostAllocation" ADD CONSTRAINT "EnterpriseCostAllocation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseCostAllocation" ADD CONSTRAINT "EnterpriseCostAllocation_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "EnterpriseProperty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EnterpriseCostAllocation" ADD CONSTRAINT "EnterpriseCostAllocation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EnterpriseGeothermalPpa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Actual delivery under contracts
CREATE TABLE "EnterpriseContractDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "deliveredMwh" DOUBLE PRECISION NOT NULL,
    "peakDeliveredMw" DOUBLE PRECISION,
    "curtailedMwh" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EnterpriseContractDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EnterpriseContractDelivery_orgId_source_externalId_key" ON "EnterpriseContractDelivery"("orgId", "source", "externalId");
CREATE INDEX "EnterpriseContractDelivery_orgId_idx" ON "EnterpriseContractDelivery"("orgId");
CREATE INDEX "EnterpriseContractDelivery_contractId_periodStart_idx" ON "EnterpriseContractDelivery"("contractId", "periodStart");
ALTER TABLE "EnterpriseContractDelivery" ADD CONSTRAINT "EnterpriseContractDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "EnterpriseOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnterpriseContractDelivery" ADD CONSTRAINT "EnterpriseContractDelivery_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "EnterpriseGeothermalPpa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
