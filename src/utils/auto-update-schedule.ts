/**
 * Utility functions for calculating automated update reminder schedules
 */

// Reminder schedule: days from pairing when reminders should be sent
const REMINDER_SCHEDULE = [1, 3, 7, 14];

// Generate additional bi-weekly reminders (28, 42, 56, 70, 84, ...)
for (let day = 28; day <= 365; day += 14) {
  REMINDER_SCHEDULE.push(day);
}

// Terminal statuses that should not receive reminders
const TERMINAL_STATUSES = ['Closed', 'Lost', 'Terminated'];

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
  const nowTime = now.getTime();
  const pairedTime = pairedDate.getTime();

  // Calculate days since pairing
  const daysSincePairing = Math.floor((nowTime - pairedTime) / (1000 * 60 * 60 * 24));

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
      if (lastAutoSentAt) {
        const lastSentDate = lastAutoSentAt instanceof Date 
          ? lastAutoSentAt 
          : new Date(lastAutoSentAt);
        const daysSinceLastSent = Math.floor((nowTime - lastSentDate.getTime()) / (1000 * 60 * 60 * 24));
        
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
  const nextSendDate = new Date(pairedTime + daysUntilNext * 24 * 60 * 60 * 1000);
  
  // Set to start of day (midnight) for consistency
  nextSendDate.setHours(0, 0, 0, 0);

  return {
    nextAt: nextSendDate,
    reason: null,
  };
}
