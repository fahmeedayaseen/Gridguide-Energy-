DROP TABLE IF EXISTS "EnterpriseContractDelivery";
DROP TABLE IF EXISTS "EnterpriseCostAllocation";
DROP TABLE IF EXISTS "EnterpriseRegulatoryMilestone";
DROP TABLE IF EXISTS "EnterpriseLoadRampStep";
DROP INDEX IF EXISTS "EnterpriseGeothermalPpa_resourceType_idx";
ALTER TABLE "EnterpriseGeothermalPpa"
    DROP COLUMN IF EXISTS "resourceType",
    DROP COLUMN IF EXISTS "contractType",
    DROP COLUMN IF EXISTS "contractedAnnualMwh",
    DROP COLUMN IF EXISTS "firmCapacityMw",
    DROP COLUMN IF EXISTS "waterIntensityGalPerMwh",
    DROP COLUMN IF EXISTS "waterIntensitySource";
ALTER TABLE "EnterpriseEnergyAsset" DROP COLUMN IF EXISTS "microgrid", DROP COLUMN IF EXISTS "firmCapacityKw";
ALTER TABLE "EnterpriseProperty"
    DROP COLUMN IF EXISTS "requiredReserveMarginPct",
    DROP COLUMN IF EXISTS "gridWaterIntensityGalPerMwh",
    DROP COLUMN IF EXISTS "gridWaterIntensitySource";
ALTER TABLE "EnterpriseSustainabilityReading" DROP COLUMN IF EXISTS "waterDischargedGallons";
