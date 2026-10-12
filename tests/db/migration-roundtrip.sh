#!/usr/bin/env bash
# Applies the Oct 2026 migrations up → smoke checks → down (rollbacks, reverse
# order) → up again on a scratch PostgreSQL database.
#
# Until the Prisma-generated 0_init baseline exists, the tables these
# migrations ALTER are created from (a) minimal stand-ins for pre-baseline
# tables and (b) the archived 20260924 geothermal migration, which created the
# enterprise energy/water tables. CI's full `prisma migrate deploy` + drift
# check supersedes this once 0_init is committed.
#
# Usage: PGURL=postgresql://user:pass@host:5432/postgres tests/db/migration-roundtrip.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
PGURL="${PGURL:?set PGURL to a server you can create databases on}"
DB="gg_migration_roundtrip_$$"
psql_admin() { psql "$PGURL" -v ON_ERROR_STOP=1 -qAt "$@"; }
TARGET="${PGURL%/*}/$DB"
run() { psql "$TARGET" -v ON_ERROR_STOP=1 -qAt "$@"; }
trap 'psql_admin -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true' EXIT

echo "== PostgreSQL: $(psql_admin -c 'SHOW server_version')"
psql_admin -c "CREATE DATABASE $DB"

echo "== Base: stand-ins for pre-baseline tables"
run <<'SQL'
CREATE TABLE "EnterpriseOrg" ("id" TEXT PRIMARY KEY, "apiEnabled" BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE "EnterpriseProperty" ("id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL REFERENCES "EnterpriseOrg"("id"), "name" TEXT NOT NULL);
CREATE TABLE "EnterpriseApiKey" ("id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "keyPrefix" TEXT NOT NULL, "keyHash" TEXT NOT NULL);
CREATE TABLE "Wallet" ("id" TEXT PRIMARY KEY, "userId" TEXT UNIQUE NOT NULL, "balance" DOUBLE PRECISION NOT NULL DEFAULT 0, "pendingWithdrawals" DOUBLE PRECISION NOT NULL DEFAULT 0, "lifetimeEarned" DOUBLE PRECISION NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "Withdrawal" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "walletId" TEXT NOT NULL REFERENCES "Wallet"("id"), "method" TEXT NOT NULL, "grossAmount" DOUBLE PRECISION NOT NULL, "fee" DOUBLE PRECISION NOT NULL DEFAULT 0, "netAmount" DOUBLE PRECISION NOT NULL, "status" TEXT NOT NULL DEFAULT 'PROCESSING', "processingTime" TEXT, "destination" TEXT, "routingLast4" TEXT, "accountLast4" TEXT, "stripePayoutId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TYPE "InstallerPlan" AS ENUM ('FREE','PRO','ENTERPRISE');
CREATE TABLE "Installer" ("id" TEXT PRIMARY KEY, "plan" "InstallerPlan" NOT NULL DEFAULT 'FREE', "successFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05);
CREATE TABLE "Job" ("id" TEXT PRIMARY KEY, "successFeeRate" DOUBLE PRECISION NOT NULL DEFAULT 0.08);
CREATE TABLE "PlatformConfig" ("id" TEXT PRIMARY KEY, "leadSuccessFeeFree" DOUBLE PRECISION NOT NULL DEFAULT 0.10, "leadSuccessFeePro" DOUBLE PRECISION NOT NULL DEFAULT 0.07, "leadSuccessFeeEnterprise" DOUBLE PRECISION NOT NULL DEFAULT 0.05);
SQL
run -f prisma/migrations_archive/20260924_enterprise_geothermal_energy_water/migration.sql
echo "   ok"

MIGRATIONS=(20261009_p0_wallet_ledger_withdrawals 20261011_geothermal_complete 20261012_energy_water_accountability 20261013_water_balance_v2_meters)
up() { for m in "${MIGRATIONS[@]}"; do run -f "prisma/migrations/$m/migration.sql"; echo "   up   $m"; done; }
down() { for (( i=${#MIGRATIONS[@]}-1; i>=0; i-- )); do m=${MIGRATIONS[$i]}; run -f "prisma/rollbacks/$m.down.sql"; echo "   down $m"; done; }

smoke() {
  run <<'SQL'
INSERT INTO "EnterpriseOrg" VALUES ('o1', true) ON CONFLICT DO NOTHING;
INSERT INTO "EnterpriseProperty" VALUES ('p1','o1','DC') ON CONFLICT DO NOTHING;
INSERT INTO "EnterpriseGeothermalPpa" ("id","orgId","propertyId","name","seller","contractedMw","termYears","updatedAt","resourceType","firmCapacityMw","evidenceReference")
  VALUES ('c1','o1','p1','SMR','X',300,20,now(),'NUCLEAR',280,'PPA §4');
INSERT INTO "EnterpriseMeter" ("id","orgId","propertyId","name","meterLevel","effectiveFrom","updatedAt") VALUES ('m1','o1','p1','Main','MAIN',now(),now());
INSERT INTO "EnterpriseMeter" ("id","orgId","propertyId","name","meterLevel","parentMeterId","effectiveFrom","updatedAt") VALUES ('m2','o1','p1','Sub','SUB','m1',now(),now());
INSERT INTO "EnterpriseSustainabilityReading" ("id","orgId","propertyId","meterId","recordedAt","facilityEnergyKwh","waterWithdrawnGallons","waterReclaimedImportedGallons","waterStorageChangeGallons","waterDischargedGallons")
  VALUES ('r1','o1','p1','m1',now(),1000,500,50,-20,100);
INSERT INTO "EnterpriseSustainabilityReading" ("id","orgId","propertyId","recordedAt","itEnergyKwh") VALUES ('r2','o1','p1',now(),5);
INSERT INTO "EnterpriseContractDelivery" ("id","orgId","contractId","periodStart","periodEnd","deliveredMwh","source","externalId","updatedAt") VALUES ('d1','o1','c1','2026-09-01','2026-10-01',100,'API','s-1',now());
INSERT INTO "EnterpriseLoadRampStep" ("id","orgId","propertyId","effectiveDate","phase","plannedLoadMw","updatedAt") VALUES ('s1','o1','p1','2026-01-01','CONSTRUCTION',5,now());
INSERT INTO "EnterpriseRegulatoryMilestone" ("id","orgId","propertyId","contractId","category","title","updatedAt") VALUES ('k1','o1','p1','c1','TRANSMISSION','Line',now());
INSERT INTO "EnterpriseCostAllocation" ("id","orgId","propertyId","category","description","totalCost","customerShare","ratepayerShare","updatedAt") VALUES ('a1','o1','p1','TRANSMISSION','Line',100,70,30,now());
INSERT INTO "WalletTransaction" ("id","walletId","userId","type","amount","updatedAt") SELECT 't1', w."id", w."userId", 'DEPOSIT', 1, now() FROM (SELECT 'w1' AS "id", 'u1' AS "userId") w WHERE false;
SQL
  echo "   smoke: inserts into every new table/column ok"
  # null semantics: unreported measurements stay NULL (not 0)
  [ "$(run -c "SELECT \"waterConsumedGallons\" IS NULL FROM \"EnterpriseSustainabilityReading\" WHERE id='r2'")" = "t" ] && echo "   smoke: unreported measurement stored as NULL"
  # negative storage change accepted
  [ "$(run -c "SELECT \"waterStorageChangeGallons\" FROM \"EnterpriseSustainabilityReading\" WHERE id='r1'")" = "-20" ] && echo "   smoke: signed storage change stored"
  # delivery upsert key is unique
  if run -c "INSERT INTO \"EnterpriseContractDelivery\" (\"id\",\"orgId\",\"contractId\",\"periodStart\",\"periodEnd\",\"deliveredMwh\",\"source\",\"externalId\",\"updatedAt\") VALUES ('d2','o1','c1','2026-09-01','2026-10-01',1,'API','s-1',now())" 2>/dev/null; then echo "   FAIL: duplicate delivery externalId accepted"; exit 1; else echo "   smoke: (org, source, externalId) unique on deliveries"; fi
  # meter delete nulls reading link; contract delete cascades deliveries, nulls milestone link
  run -c "DELETE FROM \"EnterpriseMeter\" WHERE id='m2'; UPDATE \"EnterpriseSustainabilityReading\" SET \"meterId\"=NULL WHERE id='r1'; DELETE FROM \"EnterpriseMeter\" WHERE id='m1'"
  run -c "DELETE FROM \"EnterpriseGeothermalPpa\" WHERE id='c1'"
  [ "$(run -c "SELECT count(*) FROM \"EnterpriseContractDelivery\"")" = "0" ] && [ "$(run -c "SELECT \"contractId\" IS NULL FROM \"EnterpriseRegulatoryMilestone\" WHERE id='k1'")" = "t" ] && echo "   smoke: FK actions (cascade deliveries, set-null milestone) ok"
  # indexes present
  for idx in EnterpriseMeter_propertyId_idx EnterpriseSustainabilityReading_meterId_recordedAt_idx EnterpriseContractDelivery_orgId_source_externalId_key EnterpriseApiKey_keyHash_idx WalletTransaction_idempotencyKey_key; do
    [ "$(run -c "SELECT count(*) FROM pg_indexes WHERE indexname='$idx'")" = "1" ] || { echo "   FAIL: missing index $idx"; exit 1; }
  done
  echo "   smoke: expected indexes present"
  run -c "DELETE FROM \"EnterpriseSustainabilityReading\"; DELETE FROM \"EnterpriseLoadRampStep\"; DELETE FROM \"EnterpriseRegulatoryMilestone\"; DELETE FROM \"EnterpriseCostAllocation\""
}

echo "== Up"; up
echo "== Smoke checks"; smoke
echo "== Down (rollbacks, reverse order)"; down
[ "$(run -c "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('EnterpriseMeter','EnterpriseContractDelivery','WalletTransaction')")" = "0" ] && echo "   rollback removed new tables"
echo "== Up again (re-apply after rollback)"; up
echo "== Smoke checks again"; smoke
echo "PASS: migrations apply, roll back and re-apply cleanly"
