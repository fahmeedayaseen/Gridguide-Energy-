# Installer Portal Database Package — Migration Guide

Applied from: `gridguide-installer-portal-database-links.zip`

## New Schema Models

| Model | Purpose |
|---|---|
| `Proposal` | Installer proposals (DRAFT/SENT/ACCEPTED/DECLINED/EXPIRED) |
| `InterconnectionTask` | Utility interconnection tracking per job |
| `Permit` | Permit tracking (electrical, building, solar, EV charger) |
| `InstallerCertification` | Installer credentials (GridGuide, NABCEP, etc.) |
| `ServiceZone` | Geographic service areas with radius |

## Extended Existing Models

| Model | New Fields |
|---|---|
| `Job` | `jobType`, `permitStatus`, `interconnectionStatus`, `notes`, `+ interconnectionTasks[]`, `+ permits[]` |
| `Installer` | `+ proposals[]`, `+ interconnectionTasks[]`, `+ permits[]`, `+ certifications[]`, `+ serviceZones[]` |
| `InstallerLead` | `+ proposals[]` |

## New API Routes

| Endpoint | Methods | Description |
|---|---|---|
| `/api/installers/proposals` | GET POST PATCH DELETE | Proposal lifecycle — draft → send → accept |
| `/api/installers/interconnection` | GET POST PATCH | Utility IC tasks grouped by job |
| `/api/installers/permits` | GET POST PATCH | Permit tracking, syncs job permitStatus |
| `/api/installers/jobs` | GET POST PATCH | Enhanced jobs with permit/IC status, creates payout on COMPLETED |
| `/api/installers/profile` | GET PATCH | Full profile with certifications, zones, stats |
| `/api/installers/certifications` | GET POST DELETE | Credential management |
| `/api/installers/service-zones` | GET POST DELETE | Territory management |
| `/api/admin/installers` | GET PATCH | Admin view of all installers with revenue metrics, plan management |

## Deploy Steps

```bash
# 1. Run migration
npx prisma migrate dev --name installer_portal_db_package

# 2. Seed data
npm run db:seed

# 3. Verify routes
curl http://localhost:3000/api/installers/profile
curl http://localhost:3000/api/installers/proposals
curl http://localhost:3000/api/installers/interconnection
curl http://localhost:3000/api/installers/jobs
```

## Source Database Schema (SQLite → Prisma mapping)

| SQLite Table | Prisma Model |
|---|---|
| `installer_companies` | `Installer` |
| `homeowner_leads` | `InstallerLead` |
| `installer_jobs` | `Job` |
| `proposals` | `Proposal` |
| `interconnection_tasks` | `InterconnectionTask` |
| `installer_payouts` | `InstallerPayout` |
| `service_zones` | `ServiceZone` |
| `certifications` | `InstallerCertification` |
