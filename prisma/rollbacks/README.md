# Manual rollback scripts

Prisma doesn't run down-migrations. If a release has to be rolled back, run the
matching script(s) **in reverse order** against the database (take a backup
first), then delete the migration's row from `_prisma_migrations`:

```sql
DELETE FROM "_prisma_migrations" WHERE migration_name = '<name>';
```

| Migration | Rollback | Data loss on rollback |
|---|---|---|
| `20261013_water_balance_v2_meters` | `20261013_water_balance_v2_meters.down.sql` | Meters, reading→meter links, imported-reclaimed and storage-change values, contract evidence references |
| `20261012_energy_water_accountability` | `20261012_energy_water_accountability.down.sql` | Ramp steps, milestones, cost allocations, deliveries; contract resource/firm/water fields; microgrid flags; site settings; discharge values |
| `20261011_geothermal_complete` | `20261011_geothermal_complete.down.sql` | NULL ("not measured") readings become 0 again; reading `updatedAt` |
| `20261009_p0_wallet_ledger_withdrawals` | `20261009_p0_wallet_ledger_withdrawals.down.sql` | Wallet ledger and withdrawal review fields. **Do not roll back while withdrawals are PENDING_REVIEW/PROCESSING** — resolve them first. |

Each script was applied up → down → up on PostgreSQL 16 (see `docs/evidence/pr5/`).
