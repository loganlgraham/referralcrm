# Fix Deals Closed to Use Graph Logic

## Issues

1. **"Deals closed" shows 0 instead of 7**: The card uses `filteredPaymentsByNetwork` while the graph uses `paymentsByNetwork` with different filtering logic.

2. **Close rates don't match**: Need to ensure close rate calculations match between the card and graph by using consistent cohort-based logic.

## Solution

### Issue 1: Fix Deals Closed Calculation

Change `dealsClosedInTimeframe` to use the exact same logic as the graph's `dealsByClosingDate` calculation, then filter by timeframe.

#### Current Logic (Card)
- Uses `filteredPaymentsByNetwork` (already filtered by timeframe)
- Filters: `agentAttribution !== 'OUTSIDE_AGENT'`, `usedAssignedAgent === true`, status check

#### Graph Logic
- Uses `paymentsByNetwork` (all payments, not pre-filtered by timeframe)
- Filters: `agentAttribution !== 'OUTSIDE_AGENT'`, `usedAssignedAgent === true`, status in `['closed', 'payment_sent', 'paid']`
- Uses `metricDate` to bucket by month

#### New Logic (Card - matching graph)
- Use `paymentsByNetwork` instead of `filteredPaymentsByNetwork`
- Apply same filters as graph
- Filter by `metricDate` being within `timeframeStart` and `timeframeEnd`

### Issue 2: Ensure Close Rate Consistency

Both the card and graph should use cohort-based logic consistently:

- **Card's close rate** (line 1105): Uses `dealsClosedForCloseRate` which filters `filteredPaymentsByNetwork` and checks if referral ID is in `filteredReferralIds` (referrals created in timeframe). Status: `closed` or `paid`.

- **Graph's close rate** (line 1462-1466): Uses `dealsClosedByReferralBucket` which uses `filteredPaymentsByNetwork` and buckets by referral creation date. Status: `closed` or `paid`.

Both are already cohort-based, but need to verify:
1. They use the same status filters (`closed` or `paid` - not including `payment_sent`)
2. They use the same payment filtering logic (`filteredPaymentsByNetwork`)
3. For the overall summary card, ensure it matches the sum/aggregate of the graph's monthly close rates when viewing monthly data

## Implementation

### 1. Fix dealsClosedInTimeframe

In `src/app/api/dashboard/route.ts` around line 1045:

Replace:
```typescript
const dealsClosedInTimeframe = filteredPaymentsByNetwork.filter(
  (payment) =>
    payment.agentAttribution !== 'OUTSIDE_AGENT' &&
    payment.usedAssignedAgent === true &&
    ['closed', 'payment_sent', 'paid'].includes(payment.status)
);
```

With:
```typescript
// Deals closed in timeframe: matches "Deals closed" graph logic
const dealsClosedInTimeframe = paymentsByNetwork.filter((payment) => {
  const metricDate = payment.metricDate ?? resolveMetricDate(payment);
  if (!metricDate) return false;
  if (timeframeStart && metricDate < timeframeStart) return false;
  if (timeframeEnd && metricDate > timeframeEnd) return false;
  if (payment.agentAttribution === 'OUTSIDE_AGENT') return false;
  if (payment.usedAssignedAgent !== true) return false;
  if (!['closed', 'payment_sent', 'paid'].includes(payment.status)) return false;
  return true;
});
```

### 2. Verify Close Rate Consistency

- Ensure both card and graph use `closed` or `paid` status (not `payment_sent`) for close rate calculations
- Verify that `dealsClosedForCloseRate` and `dealsClosedByReferralBucket` use the same filtering logic
- The card's close rate should match the aggregate close rate from the graph when viewing the same timeframe

## Files to Modify

1. `src/app/api/dashboard/route.ts`
   - Line ~1045: Update `dealsClosedInTimeframe` calculation
   - Verify close rate calculations use consistent logic
