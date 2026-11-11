# Fix Terminated Deals card lost referral fees

Branch: `codex/fix-terminated-deal-lost-revenue` (from `origin/main` @ 1b060ca)

## Problem

The Terminated Deals card shows $0 lost referral fees. Both termination paths zero the fee before the
dashboard reads it:

- `PATCH /api/payments` sets `expectedAmountCents = 0` whenever the request status is `terminated`.
- `POST /api/referrals/[id]/status` zeroes every payment on the referral (`Terminated`/`Lost` branch) and
  then sets `expectedAmountCents = 0` on the terminated deal.
- `/api/dashboard` computes `lostReferralFeeCents = expectedAmountCents ?? referral.referralFeeDueCents`,
  which is 0 (and the referral-wide fallback is cleared too, and may belong to the other side).
- Terminated deals are dated with `resolveMetricDate` (invoice date first), so a deal terminated today
  with an older invoice date falls outside the current range.

## Changes

1. `src/models/payment.ts`: add `terminatedAt` and `terminatedExpectedAmountCents` (both default `null`).
2. New mongoose-free helper `src/lib/server/terminated-deal-fee.ts`:
   - `resolveTerminationSnapshotUpdate` — entering `terminated` captures `{ terminatedAt: now,
     terminatedExpectedAmountCents }`; staying terminated (retry / reason edit) changes nothing;
     leaving `terminated` clears both so a later termination captures fresh values.
   - `resolveTerminatedDealLostFeeCents` — saved amount wins (including $0); legacy deals fall back
     only to deal-level data (uncleared `expectedAmountCents`, or the deal's own price × commission ×
     referral-fee inputs / flat fee); no-fee deals (agent-created, outside agent) are $0; never the
     referral-wide fee.
   - `resolveTerminationReportDate` — `terminatedAt`, else the existing generic payment date.
3. `PATCH /api/payments`: capture the fee computed for this request immediately before zeroing.
4. Status route: snapshot pre-termination fees before the referral-wide zeroing, apply on both the
   `terminateDeal` path and the `Terminated` status-sync path; clear on reactivation.
5. `/api/dashboard`: use the helpers for the terminated-deals timeframe filter and lost-fee amounts.

## Tests

- Helper unit tests (capture, retry preservation, reactivation + re-termination, $0, legacy recovery).
- `payments-patch` and `referral-status-route` regressions for both termination entry points.
- `/api/dashboard` regression (mocked models): per-deal amounts, card total, $0 fee, older invoice date;
  feed that response into `buildDashboardReport` and assert the report total matches.
