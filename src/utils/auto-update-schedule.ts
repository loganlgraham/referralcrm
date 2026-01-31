/**
 * Utility functions for calculating automated update reminder schedules
 */

import { addDays, differenceInDays, startOfDay } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

// Reminder schedule: days from pairing when reminders should be sent
const REMINDER_SCHEDULE = [1, 3, 7, 14];

// Generate additional bi-weekly reminders (28, 42, 56, 70, 84, ...)
for (let day = 28; day <= 365; day += 14) {
  REMINDER_SCHEDULE.push(day);
}

// Terminal statuses that should not receive reminders (excludes Terminated - continue cron)
const TERMINAL_STATUSES = ['Closed', 'Lost'];

// Sends occur at 8:00 AM Mountain Time (America/Denver)
const REMINDER_SEND_HOUR_MT = 8;

interface GetNextSendAtParams {
  pairedAt: Date | null | undefined;
  lastAutoSentAt: Date | null | undefined;
  autoRemindersEnabled: boolean;
  status: string;
  now?: Date;
}

interface NextSendResult {
  nextAt: Date | null;
  reason: string | null;
}

/**
 * Calculate the next scheduled automated update reminder send date
 * 
 * @returns Object with nextAt (Date or null) and reason (string or null)
 */
export function getNextAutoUpdateSendAt({
  pairedAt,
  lastAutoSentAt,
  autoRemindersEnabled,
  status,
  now = new Date(),
}: GetNextSendAtParams): NextSendResult {
  // Not enabled
  if (!autoRemindersEnabled) {
    return {
      nextAt: null,
      reason: 'Not scheduled (automation disabled)',
    };
  }

  // Terminal status
  if (TERMINAL_STATUSES.includes(status)) {
    return {
      nextAt: null,
      reason: `Not scheduled (status: ${status})`,
    };
  }

  // No pairing date
  if (!pairedAt) {
    return {
      nextAt: null,
      reason: 'Not scheduled (no pairing date)',
    };
  }

  const pairedDate = pairedAt instanceof Date ? pairedAt : new Date(pairedAt);
  const lastSentDate =
    lastAutoSentAt == null
      ? null
      : lastAutoSentAt instanceof Date
        ? lastAutoSentAt
        : new Date(lastAutoSentAt);

  // Compute "days since pairing" in Mountain Time to match the cron schedule window.
  const zonedNowStart = startOfDay(utcToZonedTime(now, SLA_TIME_ZONE));
  const zonedPairedStart = startOfDay(utcToZonedTime(pairedDate, SLA_TIME_ZONE));
  const daysSincePairing = differenceInDays(zonedNowStart, zonedPairedStart);

  // Find the next scheduled day that hasn't been sent yet
  let nextScheduledDay: number | null = null;

  for (const scheduledDay of REMINDER_SCHEDULE) {
    // Skip if this day has already passed
    if (scheduledDay < daysSincePairing) {
      continue;
    }

    // If this is today or in the future, check if we should send it
    if (scheduledDay === daysSincePairing) {
      // Today is a scheduled day - check if we already sent today
      if (lastSentDate) {
        const zonedLastSentStart = startOfDay(utcToZonedTime(lastSentDate, SLA_TIME_ZONE));
        const daysSinceLastSent = differenceInDays(zonedNowStart, zonedLastSentStart);

        // If we sent today (daysSinceLastSent === 0), next is the next scheduled day
        if (daysSinceLastSent === 0) {
          continue;
        }
      }
      // We haven't sent today, so next send is today
      nextScheduledDay = scheduledDay;
      break;
    }

    // This is a future scheduled day
    nextScheduledDay = scheduledDay;
    break;
  }

  if (nextScheduledDay === null) {
    // All scheduled days have passed
    return {
      nextAt: null,
      reason: 'Not scheduled (all reminder days have passed)',
    };
  }

  // Calculate the actual date for the next scheduled day
  const daysUntilNext = nextScheduledDay - daysSincePairing;
  const zonedNextDayStart = addDays(zonedPairedStart, daysUntilNext);

  // Pin to 8:00 AM Mountain Time, then convert back to a real UTC Date.
  const zonedNextAt = new Date(zonedNextDayStart);
  zonedNextAt.setHours(REMINDER_SEND_HOUR_MT, 0, 0, 0);
  const nextSendDate = zonedTimeToUtc(zonedNextAt, SLA_TIME_ZONE);

  return {
    nextAt: nextSendDate,
    reason: null,
  };
}
