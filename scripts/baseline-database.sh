#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Move an EXISTING database onto the new migration history (run once per DB).
#
# Background: prisma/migrations now starts with 0_init, a full baseline of the
# schema at commit 22fe0dd. A brand-new empty database needs nothing special —
# `npx prisma migrate deploy` builds it from 0_init.
#
# A database that was built the old way (`prisma db push` + the archived
# migrations) already HAS everything in 0_init. This script:
#   1. Checks the database really matches the 0_init schema (aborts if not —
#      drift must be fixed by hand first, never papered over)
#   2. Marks 0_init as applied without running it
#   3. Runs `prisma migrate deploy` to apply everything after 0_init
#
# Usage:
#   DATABASE_URL="postgresql://..." ./scripts/baseline-database.sh
# Take a backup/snapshot first.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Set DATABASE_URL to the database you're moving onto the new history, then re-run."
  exit 1
fi

echo "Target database: $(echo "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1***\2#')"
read -rp "Backup taken and ready to continue? [y/N] " CONFIRM
[ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ] || { echo "Aborted."; exit 0; }

echo "→ Checking the database matches the 0_init baseline schema..."
set +e
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/migrations_archive/schema-at-0_init.prisma \
  --exit-code > /tmp/gridguide-baseline-drift.txt 2>&1
DIFF_STATUS=$?
set -e

if [ "$DIFF_STATUS" -eq 2 ]; then
  echo "✗ The database does not match the baseline schema. Differences:"
  cat /tmp/gridguide-baseline-drift.txt
  echo ""
  echo "Resolve these first (e.g. apply any archived migration that never ran), then re-run."
  exit 1
elif [ "$DIFF_STATUS" -ne 0 ]; then
  cat /tmp/gridguide-baseline-drift.txt
  exit "$DIFF_STATUS"
fi
echo "✓ Database matches the baseline."

echo "→ Marking 0_init as already applied..."
npx prisma migrate resolve --applied "0_init"

echo "→ Applying migrations after the baseline..."
npx prisma migrate deploy

echo "→ Final check: database matches the current schema.prisma..."
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code

echo ""
echo "Done. Old rows for the archived migrations may remain in _prisma_migrations; they're harmless."
