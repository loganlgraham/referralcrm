export interface PushbackEventLike {
  pushedBackDays?: number | null;
  timestamp?: Date | string | null;
}

export interface PushbackPaymentLike {
  closingDatePushbackCount?: number | null;
  closingDatePushbacks?: PushbackEventLike[] | null;
  updatedAt?: Date | string | null;
}

export interface PushbackTimeframeLike {
  start?: Date;
  end?: Date;
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinTimeframe(value: Date | string | null | undefined, timeframe: PushbackTimeframeLike): boolean {
  const date = toValidDate(value);
  if (!date) return false;
  if (timeframe.start && date < timeframe.start) return false;
  if (timeframe.end && date > timeframe.end) return false;
  return true;
}

export function resolvePushbackMetricsInTimeframe(
  payment: PushbackPaymentLike,
  timeframe: PushbackTimeframeLike
): {
  events: number;
  pushedBackDays: number;
  /** Subset of `events` that contributed measured days (excludes legacy count-only events). */
  eventsWithDays: number;
} {
  const pushbackCountRaw =
    typeof payment.closingDatePushbackCount === 'number' && payment.closingDatePushbackCount > 0
      ? payment.closingDatePushbackCount
      : 0;
  const pushbackEntries = Array.isArray(payment.closingDatePushbacks)
    ? payment.closingDatePushbacks.filter(
        (entry): entry is { pushedBackDays: number; timestamp?: Date | string | null } =>
          typeof entry?.pushedBackDays === 'number' && entry.pushedBackDays > 0
      )
    : [];

  const paymentUpdatedInTimeframe = isWithinTimeframe(payment.updatedAt, timeframe);
  const scopedPushbackEntries = pushbackEntries.filter((entry) =>
    entry.timestamp ? isWithinTimeframe(entry.timestamp, timeframe) : paymentUpdatedInTimeframe
  );

  // Legacy rows may have a positive count but incomplete/empty pushback entries.
  // Only attribute the legacy remainder to this timeframe when we have no dated
  // entries to anchor on — otherwise an unrelated save (updatedAt in window)
  // would pull old pushbacks into the wrong period.
  const legacyEventCount = Math.max(pushbackCountRaw - pushbackEntries.length, 0);
  const hasDatedEntries = pushbackEntries.some((entry) => toValidDate(entry.timestamp ?? null) !== null);
  const scopedLegacyEvents =
    paymentUpdatedInTimeframe && !hasDatedEntries ? legacyEventCount : 0;
  const scopedEvents = scopedPushbackEntries.length + scopedLegacyEvents;
  const pushedBackDays = scopedPushbackEntries.reduce((sum, entry) => sum + entry.pushedBackDays, 0);

  return { events: scopedEvents, pushedBackDays, eventsWithDays: scopedPushbackEntries.length };
}
