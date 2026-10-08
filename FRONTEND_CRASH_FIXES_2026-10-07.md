# Front-end crash fixes — 2026-10-07

Found by type-checking `app/platform/GridGuidePlatform.jsx` for names that are used but never defined (each one throws a ReferenceError when that code runs), and by clicking through every portal in a preview build.

## Fixed
| Screen | Problem | Fix |
|---|---|---|
| GridGuide.ai homepage (`AIHome`) | `isTablet` undefined; page crashed on load | Read `isTablet` from `useBP()` |
| Homeowner dashboard sign-out (`AIDashboard`) | `setUser` undefined; Sign Out crashed | Pass `setUser` from the parent |
| Seller → Comms Center (`SellerApp`) | `seller` undefined; tab crashed on open | Pass the signed-in seller (`user`) |
| Installer → Membership upgrade (`InstPayments`) | `openModal` undefined; upgrade button crashed | Removed the dead `openModal` branch; Stripe checkout path unchanged |
| Installer and Enterprise → Referrals CSV import | `setMsg` undefined; invalid CSV crashed instead of showing an error | Added `msg` state and an error notice above the preview |

## Follow-up fixes (same day)
| Screen | Problem | Fix |
|---|---|---|
| Installer → Jobs (`InstJobsDB`) | Crashed every time: rendered `IDATA.jobs` demo array with mismatched field names | Now loads real jobs from `GET /api/installers/jobs` (shared `useInstallerJobs` hook) with loading, error and empty states. "Mark Job Complete" PATCHes the job. GridGuide fee shows the job's stored `successFee`/`successFeeRate` (none for self-sourced jobs) instead of a hard-coded 5%. |
| Installer → Schedule (`InstSchedule`) | Listed `IDATA.jobs` demo jobs | Shows real scheduled/in-progress jobs; Directions opens Google Maps; Mark Complete works. Removed the non-functional Notes button. |
| Installer dashboard "Active Jobs" KPI | Counted `IDATA.jobs` | Counts real scheduled/in-progress jobs |
| Installer → Settings → Save | Sent undefined `profile` to nonexistent `/api/installers/me` | Loads and saves via `/api/installers/profile`: notification toggles (new `Installer.notificationPrefs` JSON column, migration `20261007_installer_notification_prefs`) and real, editable service areas (replaced the hard-coded Austin list) |
| Enterprise login | Reduced Viewer-level menu until reload | `EntLogin` now passes `enterpriseRole` from the login response's `enterpriseAccess.role` |

Notes: notification preferences are now stored, but no email/alert sender reads them yet. The new migration has not been applied to a database.

## Still not fixed
- Several screens still show hard-coded sample figures (for example the admin dashboard totals and activity feed, the installer dashboard stats and "Pro Plan · 25% recurring commission" card, and the homeowner energy-flow diagram).
