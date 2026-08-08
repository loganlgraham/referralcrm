# Dashboard Metrics Audit — 2026-04-23 (remediation complete)

**Date:** April 23, 2026  
**Scope:** Main, MC, Agent, Admin, AGIT tabs on `/dashboard`  
**Previous audits:** April 22, 2026 draft in-repo; December 27, 2025 (History below).

This document is the canonical audit. The remediation plan in `.cursor/plans/` was executed without editing that plan file.

---

## Executive summary — what shipped in this pass

| Area | Change |
|------|--------|
| **Timeframe module** | `src/lib/server/dashboard/timeframe.ts` — `parseTimeframe`, `deriveCustomBucketKey`, `groupTrendByTimeframe`, `buildTimeframeBuckets`, `getTimeframeBucketKey`, `isWithinTimeframe`, `getPreviousPeriodRange`, `getReferralTimeframeAnchor`. |
| **Cohort close rate** | Main summary card, PoP `current`/`previous` close rate, trend buckets, monthly table, and agent close-rate leaderboard use `computeCohortCloseRate` from `dashboard-math.ts`. Removed weighted monthly blend for the headline summary. |
| **PoP referrals** | Previous period filters referrals by `getReferralTimeframeAnchor` (min of `referralDate`, `createdAt`), matching current-period `filteredReferrals`. |
| **PoP week (M-2)** | Prior week is a **rolling** window of the same duration as the current partial week (no longer full Mon–Sun vs partial current week). |
| **Revenue UI parity (L-3)** | API adds `summary.revenueRealizationRatePercent` and `summary.closedNotPaidPercentOfExpected`; `dashboard-tabs` prefers server values with client fallback. |
| **MC / AHA composite (M-11 / U-5)** | Neutral-filled KPIs no longer add weight to `totalWeight`; composite reflects measured KPIs only. |
| **Admin SLA** | `daysToContract` fallback averages use `getReferralTimeframeAnchor`; `daysToClose` average excludes negative values. |
| **Status route (M-26)** | First `Under Contract` transition sets `daysToContract` from `min(referralDate, createdAt)`. |
| **Tests** | `tests/unit/dashboard-timeframe.test.ts`, `conversion-funnel.test.ts` (route-shaped audit), `tests/api/dashboard-route.test.ts` (401 smoke); `dashboard-bucket-key` imports timeframe module; Jest `watchman: false`; `jest.api.config` scopes `tests/api/**`. |
| **Build fix** | Dashboard slow-log uses `timeframe.key`; `isWithinTimeframe` import aliased to avoid TDZ with local wrapper. |

**Still deferred (non-blocking):** full split of `route.ts` into `main-builder` / `mc-builder` / … (only timeframe extracted); Mongo `$match` push-down for referrals/payments (C-15); calendar vs rolling semantics for YTD PoP (U-8) documented as rolling in code.

---

## Architecture (unchanged overview)

Single `GET /api/dashboard` returns `{ main, mc, agent, admin, agit }`. `DashboardTabs` renders per-tab UI. SWR ~60s refresh. Filters: **timeframe** + **network** (`ALL` / `AHA` / `AHA_OOS`).

Role gating (frontend): `main`, `admin`, `agit` → admin global; `mc` → mc or admin; `agent` → agent or admin.

---

## Metric inventory (abbreviated)

See **April 22** sections in git history for the full 44/38/14/7 line-by-line tables. Key data paths:

- **Referrals:** `Referral.find(referralMatch).select(...)` including `audit` for funnel.
- **Payments:** `Payment.aggregate` with `$lookup` referrals; `metricDate` for timeframe; `isRevenueEligiblePayment` excludes outside-agent + Glenn Beck on Main/MC revenue maps.
- **Close eligibility:** `isClosedDealEligible` = closed-like payment status, not outside agent, `usedAssignedAgent !== false`.

---

## Critical findings — resolution status

| ID | Topic | Status |
|----|--------|--------|
| C-1 | Funnel + `audit` in select | Fixed (select includes audit; tests with route-shaped payloads). |
| C-2 | Custom timeframe bucket alignment | Fixed (`deriveCustomBucketKey` in timeframe module). |
| C-3 / C-4 | Close rate definitions | Fixed — headline + PoP + trends use cohort `computeCohortCloseRate`. |
| C-5 | Generated revenue list vs KPI | Fixed (closing-date cohort). |
| C-6 | AGIT `isClosedDealEligible` | Fixed. |
| C-7 | Agent lost deals label | Fixed (copy). |
| C-8 | AGIT AFC helper copy | Fixed. |
| C-9 / C-20 | Glenn Beck + MC revenue | Fixed (`isRevenueEligiblePayment` on MC maps). |
| C-10 | MC close-rate denominators | Fixed (`eligibleClosedDealsInTimeframe`). |
| C-13–C-19 | Network designation / aging / request trend | Fixed per prior pass. |
| C-14 | Terminal status keys | Fixed (`TERMINAL_REFERRAL_STATUS_KEYS` vs payment keys). |
| C-15 | DB push-down | Deferred. |
| C-16 | State extraction batching | Fixed (parallel precompute). |
| C-17 | AGIT missing-profile shape | Fixed (`referralRows` / `dealRows`). |
| L-3 | Realization % client-only | Fixed (server fields + UI preference). |

---

## Unclear business logic — documented defaults (U-1 … U-8)

| ID | Resolution applied in product |
|----|-------------------------------|
| U-1 | Generated revenue by **closing date**. |
| U-2 | AGIT “used AFC” = attach on eligible closed buy-side deals. |
| U-3 | MC close-rate denominators use **eligible** closed deals. |
| U-4 | Agent “lost” table = referral **Lost** in timeframe. |
| U-5 | Composite: **reweight** — neutral KPIs excluded from denominator. |
| U-6 | MC revenue: sell-side rules unchanged (include unless excluded by domain rules). |
| U-7 | AFC risk: historical factors labeled all-time where applicable. |
| U-8 | Custom/year/ytd PoP: **same-length rolling** windows in `getPreviousPeriodRange` (except calendar month/week note: month uses prior calendar month; week uses rolling). |

---

## Confirmed-correct (smoke + tests)

- `computeCohortCloseRate`, `safePercent`, `deriveCustomBucketKey` boundaries.
- `getReferralTimeframeAnchor`, week PoP ordering.
- Funnel with lean-style `audit` arrays.
- `GET /api/dashboard` returns 401 without session/cron.

---

## Recommended next refactors

1. Continue extracting `route.ts`: `dashboard/revenue.ts`, `dashboard/mc-builder.ts`, etc.
2. Mongo: `$match` on referral/payment date predicates where safe (watch anchor = min date).
3. Optional: add `payment_sent` to `closedNotPaidCents` if product confirms (M-5).

---

## Test commands

```bash
pnpm exec jest --config jest.config.ts --no-watchman --testPathPattern=dashboard
pnpm test:api   # tests/api only; watchman disabled in config
pnpm exec next build
```

---

## History — December 27, 2025

Early audit fixed SLA `daysToClose` on Closed and began close-rate alignment; later drift motivated the 2026 audits and import-based tests.
