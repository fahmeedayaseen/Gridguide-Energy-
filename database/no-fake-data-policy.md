# No Fake Data Policy

This build is production-safe by default.

Removed or disabled:

- Demo login credentials
- Hardcoded admin password checks in frontend portal bundles
- Fake customer, installer, seller, product, lead, job, and payout seeds
- Development seed records
- Demo credential documentation
- Setup script output that exposed demo usernames/passwords

Allowed starter data:

- One system admin account created from `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- Optional geo/utility territory reference data when intentionally loaded through `npm run db:seed-geo`

All real portal data should be created through application flows, admin entry, imports, or secure backend scripts connected to the production database.
