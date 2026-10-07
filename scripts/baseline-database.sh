#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Baseline the Prisma migration history for an EXISTING database.
#
# Why this exists: this project's earliest tables were created with
# `prisma db push` (schema synced directly to the DB, no migration file
# recorded). Every migration in prisma/migrations/ from 20260626 onward is
# real and incremental, but there's no "0_init" migration for everything
# before that date — so on a FRESH/EMPTY database, `prisma migrate deploy`
# fails immediately (it tries to ALTER tables that don't exist yet).
#
# This script does NOT touch a database that already has data (e.g. your
# current staging/prod DB provisioned via db push) — for that database, skip
# this script entirely and just keep running `prisma migrate deploy` for
# future migrations; the tables already match schema.prisma.
#
# Use this script when standing up a BRAND NEW database (e.g. a fresh
# production instance) so `prisma migrate deploy` works cleanly from a
# proper migration history, following Prisma's own documented "baselining"
# procedure: https://www.prisma.io/docs/guides/database/baselining
#
# Usage:
#   DATABASE_URL="postgresql://...brand-new-empty-db..." ./scripts/baseline-database.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Set DATABASE_URL to the NEW, EMPTY database you're baselining, then re-run."
  exit 1
fi

BASELINE_DIR="prisma/migrations/0_init"

echo "This will:"
echo "  1. Generate prisma/migrations/0_init/migration.sql from the current schema.prisma"
echo "  2. Apply it directly to the database at DATABASE_URL"
echo "  3. Mark it as already-applied in Prisma's migration history table"
echo ""
echo "Target database: $(echo "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#')"
read -rp "Continue? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

mkdir -p "$BASELINE_DIR"

echo "→ Generating baseline SQL from schema.prisma..."
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$BASELINE_DIR/migration.sql"

echo "→ Applying baseline directly to the database..."
npx prisma db execute --file "$BASELINE_DIR/migration.sql" --schema prisma/schema.prisma

echo "→ Marking 0_init as already applied in Prisma's migration history..."
npx prisma migrate resolve --applied "0_init"

echo "→ Verifying: running migrate deploy should now report 'No pending migrations'..."
npx prisma migrate deploy

echo ""
echo "Done. This database now has a real migration history starting from 0_init."
echo "Every migration from 20260626 onward will apply cleanly on top of it."
