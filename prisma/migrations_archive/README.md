# Archived migrations

These are the original incremental migrations (2026-06-26 → 2026-09-24).
They are **not applied** any more and Prisma does not read this folder.

They could never build a database from scratch: the earliest tables were
created with `prisma db push`, so the first migration here ALTERs tables that
no migration ever creates. `prisma migrate deploy` on an empty database failed
immediately (Audit §8).

They were replaced by `prisma/migrations/0_init` — a single baseline generated
by Prisma from the schema at commit 22fe0dd (`schema-at-0_init.prisma` here) —
followed by normal incremental migrations.

To move an existing database (created by `db push` + these migrations) onto
the new history, run `scripts/baseline-database.sh` once. Kept for reference only.
