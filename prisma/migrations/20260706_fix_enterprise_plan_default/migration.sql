-- Fixes real schema drift: the original 20260630_enterprise_portal
-- migration set EnterpriseOrg.plan's DATABASE default to 'BUSINESS'.
-- When the enterprise tier rename shipped, schema.prisma's declared
-- @default() was updated to 'ENTERPRISE_BASIC', but no migration ever
-- changed the actual column default in Postgres, and no existing rows
-- were backfilled. Any org row inserted without an explicit plan value
-- via raw SQL (bypassing Prisma Client) would still silently get
-- 'BUSINESS' - a value that appears nowhere in ENTERPRISE_PLANS and
-- would break every plan-lookup in the Enterprise Portal for that org.

ALTER TABLE "EnterpriseOrg" ALTER COLUMN "plan" SET DEFAULT 'ENTERPRISE_BASIC';

UPDATE "EnterpriseOrg" SET "plan" = 'ENTERPRISE_BASIC' WHERE "plan" = 'BUSINESS';
UPDATE "EnterpriseOrg" SET "plan" = 'ENTERPRISE_PRO'   WHERE "plan" = 'PROFESSIONAL';
UPDATE "EnterpriseOrg" SET "plan" = 'ENTERPRISE_SCALE' WHERE "plan" = 'ENTERPRISE';
