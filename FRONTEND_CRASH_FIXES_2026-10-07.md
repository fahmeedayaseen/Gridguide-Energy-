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

## Not fixed (needs a decision)
- **Installer → Jobs (`InstJobsDB`) crashes every time.** It renders the old built-in demo array `IDATA.jobs`, whose fields (`type`, `permitStatus`, `icStatus`) don't match what the screen reads (`job_type`, `permit_status`, `interconnection_status`). No front-end code calls a real jobs API. Needs wiring to a real endpoint.
- **Installer → Settings → Save** sends `profile`, which is never defined. The intended payload is unclear (the screen only holds notification toggles).
- **Enterprise login shows a reduced menu until reload.** `EntLogin` passes `data.user` without `enterpriseRole`, so the nav filters to Viewer-level items; `/api/users/me` on reload sets the role correctly.
- Several screens still show hard-coded sample figures (for example the admin dashboard totals and activity feed, the installer dashboard stats and "Pro Plan · 25% recurring commission" card, and the homeowner energy-flow diagram).
