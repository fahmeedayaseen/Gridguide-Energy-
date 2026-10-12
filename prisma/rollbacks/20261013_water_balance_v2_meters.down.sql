ALTER TABLE "EnterpriseSustainabilityReading" DROP CONSTRAINT IF EXISTS "EnterpriseSustainabilityReading_meterId_fkey";
DROP INDEX IF EXISTS "EnterpriseSustainabilityReading_meterId_recordedAt_idx";
DROP TABLE IF EXISTS "EnterpriseMeter";
ALTER TABLE "EnterpriseGeothermalPpa" DROP COLUMN IF EXISTS "evidenceReference";
ALTER TABLE "EnterpriseSustainabilityReading"
    DROP COLUMN IF EXISTS "meterId",
    DROP COLUMN IF EXISTS "waterStorageChangeGallons",
    DROP COLUMN IF EXISTS "waterReclaimedImportedGallons";
