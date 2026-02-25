---
name: Timeframe-aware task completion metrics
overview: Change the "Completed today" and "Completion rate today" cards on the Admin dashboard to follow the dashboard timeframe filter, renaming them to "Tasks Completed" and "Task Completion Rate".
todos:
  - id: api-timeframe-filter
    content: Change completedTodayCount to completedInTimeframeCount using timeframeStart/timeframeEnd in dashboard route
    status: completed
  - id: frontend-rename
    content: Rename type field and update card titles/helpers in AdminDashboard component
    status: completed
isProject: false
---

# Make Task Completion Metrics Follow Timeframe Filter

## Changes

### 1. API: Use timeframe range instead of today for `completedTodayCount`

In `[src/app/api/dashboard/route.ts](src/app/api/dashboard/route.ts)`, the `completedTodayCount` variable (lines 2171-2176) is currently hardcoded to filter `completedAt` within `todayStart` / `todayEnd`. Change it to use `timeframeStart` / `timeframeEnd` (already available at line 819), and also count dismissed tasks in the same range:

```typescript
// Before (line 2171)
const completedTodayCount = adminTasks.filter((task) => {
  const at = task.completedAt;
  if (!at) return false;
  const d = new Date(at);
  return d >= todayStart && d <= todayEnd;
}).length;

// After
const completedInTimeframeCount = adminTasks.filter((task) => {
  const at = task.completedAt ?? task.dismissedAt;
  if (!at) return false;
  const d = new Date(at);
  if (timeframeStart && d < timeframeStart) return false;
  if (timeframeEnd && d > timeframeEnd) return false;
  return true;
}).length;
```

Update the field name in both the main response payload (line ~2528) and the missing-profile fallback (line ~790) from `completedTodayCount` to `completedInTimeframeCount`.

### 2. Frontend type: Rename the field

In `[src/components/dashboard/dashboard-tabs.tsx](src/components/dashboard/dashboard-tabs.tsx)`, update the `DashboardResponse['admin']` interface (line ~216) to rename `completedTodayCount` to `completedInTimeframeCount`.

### 3. Frontend cards: Rename and update helpers

In the `AdminDashboard` function (line ~1753), update the two cards:

- **"Completed today"** --> **"Tasks completed"** using `data.completedInTimeframeCount`, helper changed from "Tasks completed or dismissed today" to "Tasks completed or dismissed in period"
- **"Completion rate today"** --> **"Task completion rate"**, same formula but using `completedInTimeframeCount`, helper text updated similarly

### Files to modify

- `[src/app/api/dashboard/route.ts](src/app/api/dashboard/route.ts)` -- change `completedTodayCount` to `completedInTimeframeCount` using `timeframeStart`/`timeframeEnd`
- `[src/components/dashboard/dashboard-tabs.tsx](src/components/dashboard/dashboard-tabs.tsx)` -- rename type field and update card labels/helpers

