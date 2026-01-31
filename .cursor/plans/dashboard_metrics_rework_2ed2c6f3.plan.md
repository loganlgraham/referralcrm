---
name: Dashboard metrics rework
overview: Fix main dashboard metric logic so Pending closings and Closed counts match your definitions, make the former “MC transfers” chart show Total referrals trend (matching the top card), and rework the metric tiles under the graphs to add referral-request breakdowns by source/endorser/state grouped alongside revenue breakdowns.
todos:
  - id: pending-closings-month-subcounts
    content: Update `/api/dashboard` pending closings month subcounts to count all non-terminated deals with closingDate in current/next month (independent of timeframe).
    status: completed
  - id: closed-metric-fix
    content: Decouple cohort-based close-rate numerator from the summary “Closed” metric; make summary closed count timeframe-based and align with deals-closed logic.
    status: completed
  - id: replace-mc-transfers-chart
    content: Replace main dashboard “MC transfers” chart with cumulative “Referrals received” trend that matches the Total referrals card for the selected timeframe.
    status: completed
  - id: ranked-metrics-rework
    content: Remove referralRequestsByZip; add referral requests by source/endorser/state in API + UI; regroup ranked cards by category (revenue vs request counts).
    status: completed
  - id: type-updates-and-sanity-check
    content: Update `DashboardResponse`/`DashboardSummary` typings and ensure all dashboards compile after field changes.
    status: completed
isProject: false
---

## Goals

- **Pending closings card**
  - Large number: count **future** deals with status in `under_contract | past_inspection | past_appraisal | clear_to_close` (ignore timeframe filter).
  - Subcounts:
    - **This month**: count deals with a `closingDate` in the current calendar month and **status != terminated** (include pending + closed/paid/payment_sent).
    - **Next month**: same for next calendar month.
- **Total referrals card subtext “Closed”**: make it match the “Deals closed” logic and respect the timeframe (so “This month” works).
- **Replace the main-dashboard “MC transfers” chart** with a **Total referrals trend** that matches the “Total referrals” card.
- **Rework the ranked metric tiles under the graphs**:
  - Remove “Referral requests by ZIP”.
  - Add “Referral requests by source”, “Referral requests by endorser”, and “Referral requests by state”.
  - Group similar categories together visually (revenue + referral requests).

## Key files

- API computations: `[src/app/api/dashboard/route.ts](/Users/loganlgraham/.cursor/worktrees/referralcrm/gkp/src/app/api/dashboard/route.ts)`
- Dashboard UI/types/layout: `[src/components/dashboard/dashboard-tabs.tsx](/Users/loganlgraham/.cursor/worktrees/referralcrm/gkp/src/components/dashboard/dashboard-tabs.tsx)`

## Implementation details

### 1) Pending closings: keep future-under-contract for the big number; change month subcounts

In `[src/app/api/dashboard/route.ts](/Users/loganlgraham/.cursor/worktrees/referralcrm/gkp/src/app/api/dashboard/route.ts)`:

- Keep the existing `pendingClosings` logic based on `paymentsByNetwork` and future `closingDate` (already independent of timeframe):

```893:915:src/app/api/dashboard/route.ts
const pendingClosings = paymentsByNetwork.filter((payment) => {
  if (!dealStatuses.includes(payment.status)) return false;
  if (payment.usedAssignedAgent !== true) return false;
  const closingDate = payment.closingDate ? new Date(payment.closingDate) : null;
  if (!closingDate) return false;
  return closingDate > endOfToday;
});
```

- Replace `pendingClosingsThisMonth` / `pendingClosingsNextMonth` to be based on:
  - `paymentsByNetwork`
  - `payment.usedAssignedAgent === true`
  - `payment.status !== 'terminated'`
  - `closingDate` in month range (exclude missing closing dates as you requested)

This will ensure those subcounts are **not just pending**, but include closed/paid/payment_sent too.

### 2) Fix “Closed” (summary) to match the graph and timeframe

Currently the API’s `dealsClosed` is cohort-based (referrals created in timeframe) and excludes `payment_sent`, which causes the mismatch:

```870:876:src/app/api/dashboard/route.ts
const dealsClosed = filteredPaymentsByNetwork.filter(
  (payment) =>
    payment.agentAttribution !== 'OUTSIDE_AGENT' &&
    payment.usedAssignedAgent === true &&
    (payment.status === 'closed' || payment.status === 'paid') &&
    filteredReferralIds.has(payment.referral._id.toString())
);
```

Plan:

- Keep this cohort logic **only for close-rate math** (rename internally to avoid confusion).
- Add a new `dealsClosedInTimeframe` using `filteredPaymentsByNetwork` with statuses `closed | payment_sent | paid`, plus `agentAttribution !== 'OUTSIDE_AGENT'` and `usedAssignedAgent === true`.
- Return `summary.dealsClosed = dealsClosedInTimeframe.length` so the “Closed” subtext matches the “Deals closed” trend and respects the timeframe selector.

### 3) Replace “MC transfers” chart with “Referrals received” chart that matches total referrals

In the main dashboard UI, the chart header shows the **last datapoint value** (not a sum):

```351:409:src/components/dashboard/dashboard-tabs.tsx
const activeIndex = hoverIndex != null ? hoverIndex : safeData.length > 0 ? safeData.length - 1 : null;
// ...
{activePoint ? (
  <div className="text-right text-sm text-slate-700">
    <p className="font-semibold">{formatValue(activePoint.value)}</p>
    <p className="text-xs text-slate-500">{activePoint.label}</p>
  </div>
) : null}
```

To guarantee the displayed number matches the “Total referrals” card for the selected timeframe:

- Add `main.trends.referrals` in the API built from `filteredReferrals` using the existing `groupTrendByTimeframe()` helper, but **convert it to a cumulative series** so the last point equals the timeframe total.
- Update `[src/components/dashboard/dashboard-tabs.tsx](/Users/loganlgraham/.cursor/worktrees/referralcrm/gkp/src/components/dashboard/dashboard-tabs.tsx)` to:
  - Replace the “MC transfers” chart with “Referrals received”
  - Wire it to `data.trends.referrals`
  - Update the `DashboardResponse` type accordingly.

### 4) Rework ranked metrics under graphs: add referral-request breakdowns and group them

API (`src/app/api/dashboard/route.ts`):

- Replace `referralZipMap` / `referralRequestsByZip` with:
  - `referralRequestsBySource` (from `filteredReferrals`, normalize missing as `Unknown`)
  - `referralRequestsByEndorser` (trim, fallback `Unattributed`)
  - `referralRequestsByState` (use `extractState(referral)`)

UI (`src/components/dashboard/dashboard-tabs.tsx`):

- Replace the current single 4-column block:

```1348:1358:src/components/dashboard/dashboard-tabs.tsx
<div className="grid gap-4 lg:grid-cols-4">
  <RankedList title="Revenue by source" items={data.revenueBySource} />
  <RankedList title="Revenue by endorser" items={data.revenueByEndorser} />
  <RankedList title="Revenue by state" items={data.revenueByState} />
  <RankedList title="Referral requests by ZIP" items={data.referralRequestsByZip} ... />
</div>
```

- With grouped grids, for example:
  - Row 1 (4 cols): Revenue by source + Referral requests by source + Revenue by endorser + Referral requests by endorser
  - Row 2 (2 cols): Revenue by state + Referral requests by state

## Verification

- Manually verify (dev) that:
  - Pending closings big number ignores timeframe changes.
  - Pending closings subcounts match calendar month closings across **all** non-terminated deal statuses.
  - “Closed” subtext equals the count implied by the “Deals closed” logic within the selected timeframe.
  - “Referrals received” chart last value equals the “Total referrals” card for each timeframe preset.
  - New ranked lists render and are correctly sorted/empty-state handled.

