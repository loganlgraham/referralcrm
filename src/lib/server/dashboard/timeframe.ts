import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfHour,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
  subYears
} from 'date-fns';

export type TimeframeKey =
  | 'day'
  | 'week'
  | 'last_week'
  | 'next_week'
  | 'month'
  | 'last_month'
  | 'next_month'
  | 'year'
  | 'ytd'
  | 'all'
  | 'custom';

const WEEK_OPTIONS = { weekStartsOn: 1 as const };

export interface TimeframeInfo {
  key: TimeframeKey;
  label: string;
  start?: Date;
  end?: Date;
}

export interface TrendPoint {
  key: string;
  label: string;
  value: number;
}

export const TIMEFRAME_LABELS: Record<TimeframeKey, string> = {
  day: 'Today',
  week: 'This Week',
  last_week: 'Last Week',
  next_week: 'Next Week',
  month: 'This Month',
  last_month: 'Last Month',
  next_month: 'Next Month',
  year: 'Last 12 Months',
  ytd: 'Year to Date',
  all: 'All time',
  custom: 'Custom range'
};

function parseDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function parseTimeframe(
  value: string | null,
  startParam: string | null,
  endParam: string | null
): TimeframeInfo {
  const now = new Date();
  const normalizedKey: TimeframeKey =
    value === 'day' ||
    value === 'week' ||
    value === 'last_week' ||
    value === 'next_week' ||
    value === 'month' ||
    value === 'last_month' ||
    value === 'next_month' ||
    value === 'year' ||
    value === 'ytd' ||
    value === 'all' ||
    value === 'custom'
      ? (value as TimeframeKey)
      : 'month';

  if (normalizedKey === 'custom') {
    const startDate = parseDateOnly(startParam);
    const endDate = parseDateOnly(endParam);

    let start = startDate ? startOfDay(startDate) : null;
    let end = endDate ? endOfDay(endDate) : null;

    if (start && end && start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    const fallbackStart = start ?? startOfMonth(now);
    const fallbackEnd = end ?? endOfDay(now);
    const label =
      start && end
        ? `Custom (${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')})`
        : TIMEFRAME_LABELS.custom;

    return {
      key: 'custom',
      label,
      start: start ?? fallbackStart,
      end: end ?? fallbackEnd
    };
  }

  switch (normalizedKey) {
    case 'day':
      return {
        key: 'day',
        label: TIMEFRAME_LABELS.day,
        start: startOfDay(now),
        end: endOfDay(now)
      };
    case 'week':
      return {
        key: 'week',
        label: TIMEFRAME_LABELS.week,
        start: startOfWeek(now, WEEK_OPTIONS),
        end: endOfDay(now)
      };
    case 'last_week': {
      const lastWeek = subWeeks(now, 1);
      return {
        key: 'last_week',
        label: TIMEFRAME_LABELS.last_week,
        start: startOfWeek(lastWeek, WEEK_OPTIONS),
        end: endOfWeek(lastWeek, WEEK_OPTIONS)
      };
    }
    case 'next_week': {
      const nextWeek = addWeeks(now, 1);
      return {
        key: 'next_week',
        label: TIMEFRAME_LABELS.next_week,
        start: startOfWeek(nextWeek, WEEK_OPTIONS),
        end: endOfWeek(nextWeek, WEEK_OPTIONS)
      };
    }
    case 'year':
      return {
        key: 'year',
        label: TIMEFRAME_LABELS.year,
        start: subYears(now, 1),
        end: endOfDay(now)
      };
    case 'next_month': {
      const nextMonth = addMonths(now, 1);
      return {
        key: 'next_month',
        label: TIMEFRAME_LABELS.next_month,
        start: startOfMonth(nextMonth),
        end: endOfMonth(nextMonth)
      };
    }
    case 'last_month': {
      const lastMonth = subMonths(now, 1);
      return {
        key: 'last_month',
        label: TIMEFRAME_LABELS.last_month,
        start: startOfMonth(lastMonth),
        end: endOfMonth(lastMonth)
      };
    }
    case 'ytd':
      return {
        key: 'ytd',
        label: TIMEFRAME_LABELS.ytd,
        start: startOfYear(now),
        end: endOfDay(now)
      };
    case 'all':
      return {
        key: 'all',
        label: TIMEFRAME_LABELS.all,
        end: endOfDay(now)
      };
    case 'month':
      return {
        key: 'month',
        label: TIMEFRAME_LABELS.month,
        start: startOfMonth(now),
        end: endOfMonth(now)
      };
    default: {
      const exhaustive: never = normalizedKey;
      return exhaustive;
    }
  }
}

/**
 * Canonical day-diff → bucket-type table for custom timeframes.
 * Used by groupTrendByTimeframe, buildTimeframeBuckets, and getTimeframeBucketKey.
 */
export function deriveCustomBucketKey(dayDiff: number): TimeframeKey {
  if (dayDiff <= 1) return 'day';
  if (dayDiff <= 7) return 'week';
  if (dayDiff <= 180) return 'month';
  return 'year';
}

export function groupTrendByTimeframe(dates: Date[], timeframe: TimeframeInfo): TrendPoint[] {
  if (dates.length === 0) return [];

  if (timeframe.key === 'custom') {
    const firstDate = new Date(dates[0]);
    const earliest = dates.reduce((min, current) => {
      const candidate = new Date(current);
      return candidate < min ? candidate : min;
    }, firstDate);
    const latest = dates.reduce((max, current) => {
      const candidate = new Date(current);
      return candidate > max ? candidate : max;
    }, firstDate);

    const rangeStart = timeframe.start ?? earliest;
    const rangeEnd = timeframe.end ?? latest;
    const dayDiff = Math.max(differenceInCalendarDays(rangeEnd, rangeStart), 0);

    const derivedKey: TimeframeKey = deriveCustomBucketKey(dayDiff);

    return groupTrendByTimeframe(dates, { ...timeframe, key: derivedKey });
  }

  const buckets = new Map<string, { label: string; value: number; sort: number }>();

  dates.forEach((date) => {
    const d = new Date(date);
    let key: string;
    let label: string;
    let sortValue: number;

    switch (timeframe.key) {
      case 'day': {
        const hourStart = startOfHour(d);
        key = format(hourStart, 'yyyy-MM-dd-HH');
        label = format(hourStart, 'ha');
        sortValue = hourStart.getTime();
        break;
      }
      case 'week':
      case 'last_week':
      case 'next_week': {
        const dayStart = startOfDay(d);
        key = format(dayStart, 'yyyy-MM-dd');
        label = format(dayStart, 'EEE dd');
        sortValue = dayStart.getTime();
        break;
      }
      case 'month':
      case 'last_month':
      case 'next_month': {
        const weekStart = startOfWeek(d, WEEK_OPTIONS);
        key = `${format(weekStart, 'yyyy')}-W${format(weekStart, 'II')}`;
        label = `${format(weekStart, 'MMM d')}`;
        sortValue = weekStart.getTime();
        break;
      }
      case 'year':
      case 'ytd':
      case 'all':
      case 'custom': {
        const monthStart = startOfMonth(d);
        key = `${format(monthStart, 'yyyy-MM')}`;
        label = format(monthStart, 'MMM yy');
        sortValue = monthStart.getTime();
        break;
      }
      default: {
        const exhaustive: never = timeframe.key;
        throw new Error(`Unhandled timeframe: ${exhaustive}`);
      }
    }

    const bucket = buckets.get(key);
    if (bucket) {
      bucket.value += 1;
    } else {
      buckets.set(key, { label, value: 1, sort: sortValue });
    }
  });

  return Array.from(buckets.entries())
    .map(([key, bucket]) => ({ key, label: bucket.label, value: bucket.value, sort: bucket.sort }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _sort, ...rest }) => rest);
}

interface TimeframeBucket {
  key: string;
  label: string;
  sort: number;
}

export function buildTimeframeBuckets(timeframe: TimeframeInfo): TimeframeBucket[] {
  const now = new Date();
  let effectiveKey: TimeframeKey = timeframe.key;
  let rangeStart: Date;
  let rangeEnd: Date;

  if (timeframe.key === 'custom') {
    const start = timeframe.start ?? startOfMonth(now);
    const end = timeframe.end ?? endOfDay(now);
    const dayDiff = Math.max(differenceInCalendarDays(end, start), 0);
    effectiveKey = deriveCustomBucketKey(dayDiff);
    rangeStart = startOfDay(start);
    rangeEnd = endOfDay(end);
  } else if (timeframe.key === 'all') {
    rangeStart = subYears(timeframe.end ?? now, 2);
    rangeEnd = endOfDay(timeframe.end ?? now);
    effectiveKey = 'year';
  } else {
    rangeStart = timeframe.start ? startOfDay(timeframe.start) : startOfDay(now);
    rangeEnd = timeframe.end ? endOfDay(timeframe.end) : endOfDay(now);
  }

  const buckets: TimeframeBucket[] = [];
  let cursor: Date;

  switch (effectiveKey) {
    case 'day': {
      cursor = startOfHour(rangeStart);
      const endHour = endOfDay(rangeEnd);
      while (cursor <= endHour) {
        buckets.push({
          key: format(cursor, 'yyyy-MM-dd-HH'),
          label: format(cursor, 'ha'),
          sort: cursor.getTime()
        });
        cursor = addHours(cursor, 1);
      }
      break;
    }
    case 'week':
    case 'last_week':
    case 'next_week': {
      cursor = startOfDay(rangeStart);
      while (cursor <= rangeEnd) {
        buckets.push({
          key: format(cursor, 'yyyy-MM-dd'),
          label: format(cursor, 'EEE dd'),
          sort: cursor.getTime()
        });
        cursor = addDays(cursor, 1);
      }
      break;
    }
    case 'month':
    case 'last_month':
    case 'next_month': {
      cursor = startOfWeek(rangeStart, WEEK_OPTIONS);
      const endWeek = startOfWeek(rangeEnd, WEEK_OPTIONS);
      while (cursor <= endWeek) {
        buckets.push({
          key: `${format(cursor, 'yyyy')}-W${format(cursor, 'II')}`,
          label: format(cursor, 'MMM d'),
          sort: cursor.getTime()
        });
        cursor = addWeeks(cursor, 1);
      }
      break;
    }
    case 'year':
    case 'ytd':
    case 'all':
    case 'custom': {
      cursor = startOfMonth(rangeStart);
      const endMonth = startOfMonth(rangeEnd);
      while (cursor <= endMonth) {
        buckets.push({
          key: `${format(cursor, 'yyyy-MM')}`,
          label: format(cursor, 'MMM yy'),
          sort: cursor.getTime()
        });
        cursor = addMonths(cursor, 1);
      }
      break;
    }
    default: {
      const exhaustive: never = effectiveKey;
      throw new Error(`Unhandled timeframe: ${exhaustive}`);
    }
  }

  return buckets;
}

export function getTimeframeBucketKey(date: Date, timeframe: TimeframeInfo): string {
  let effectiveKey: TimeframeKey = timeframe.key;

  if (timeframe.key === 'custom' && timeframe.start && timeframe.end) {
    const dayDiff = Math.max(differenceInCalendarDays(timeframe.end, timeframe.start), 0);
    effectiveKey = deriveCustomBucketKey(dayDiff);
  } else if (timeframe.key === 'all') {
    effectiveKey = 'year';
  }

  const d = new Date(date);
  switch (effectiveKey) {
    case 'day':
      return format(startOfHour(d), 'yyyy-MM-dd-HH');
    case 'week':
    case 'last_week':
    case 'next_week':
      return format(startOfDay(d), 'yyyy-MM-dd');
    case 'month':
    case 'last_month':
    case 'next_month': {
      const weekStart = startOfWeek(d, WEEK_OPTIONS);
      return `${format(weekStart, 'yyyy')}-W${format(weekStart, 'II')}`;
    }
    case 'year':
    case 'ytd':
    case 'all':
    case 'custom':
      return format(startOfMonth(d), 'yyyy-MM');
    default: {
      const exhaustive: never = effectiveKey;
      throw new Error(`Unhandled timeframe: ${exhaustive}`);
    }
  }
}

export function isWithinTimeframe(date: Date | null | undefined, timeframe: TimeframeInfo): boolean {
  if (!date) return false;
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return false;
  if (timeframe.start && value < timeframe.start) return false;
  if (timeframe.end && value > timeframe.end) return false;
  return true;
}

/** Earliest meaningful date for cohort / timeframe membership (AGENTS.md). */
export function getReferralTimeframeAnchor(referral: {
  createdAt?: Date | string | null;
  referralDate?: Date | string | null;
}): Date | null {
  const createdAt = referral.createdAt ? new Date(referral.createdAt) : null;
  const referralDate = referral.referralDate ? new Date(referral.referralDate) : null;
  const createdOk = createdAt && !Number.isNaN(createdAt.getTime());
  const refOk = referralDate && !Number.isNaN(referralDate.getTime());
  if (createdOk && refOk) {
    return referralDate!.getTime() < createdAt!.getTime() ? referralDate! : createdAt!;
  }
  return (refOk ? referralDate : null) ?? (createdOk ? createdAt : null);
}

/**
 * Prior period for PoP deltas. Week/month use calendar buckets where noted;
 * week also uses a rolling window the same length as the current partial week
 * so we never compare a partial week to a full prior week.
 */
export function getPreviousPeriodRange(timeframe: TimeframeInfo): { start: Date; end: Date } | null {
  const currentStart = timeframe.start;
  const currentEnd = timeframe.end;
  if (!currentStart || !currentEnd || currentStart.getTime() >= currentEnd.getTime()) {
    return null;
  }

  switch (timeframe.key) {
    case 'all':
      return null;
    case 'day': {
      const previousDay = addDays(startOfDay(currentStart), -1);
      return {
        start: startOfDay(previousDay),
        end: endOfDay(previousDay)
      };
    }
    case 'week': {
      const periodMs = currentEnd.getTime() - currentStart.getTime();
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(previousEnd.getTime() - periodMs);
      return {
        start: startOfDay(previousStart),
        end: endOfDay(previousEnd)
      };
    }
    case 'last_week':
    case 'next_week': {
      const weekStart = startOfWeek(currentStart, WEEK_OPTIONS);
      const previousStart = subWeeks(weekStart, 1);
      return {
        start: previousStart,
        end: endOfWeek(previousStart, WEEK_OPTIONS)
      };
    }
    case 'month':
    case 'last_month':
    case 'next_month': {
      const currentMonthStart = startOfMonth(currentStart);
      const previousMonthStart = startOfMonth(subMonths(currentMonthStart, 1));
      return {
        start: previousMonthStart,
        end: endOfMonth(previousMonthStart)
      };
    }
    case 'custom':
    case 'year':
    case 'ytd': {
      const periodMs = currentEnd.getTime() - currentStart.getTime();
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(previousEnd.getTime() - periodMs);
      return {
        start: previousStart,
        end: previousEnd
      };
    }
    default: {
      const exhaustive: never = timeframe.key;
      throw new Error(`Unhandled timeframe: ${exhaustive}`);
    }
  }
}
