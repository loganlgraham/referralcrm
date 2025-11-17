import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';

export const TASK_TIME_ZONE = 'America/Denver';
const TASK_TIME_FORMAT = "MMM d 'at' h:mmaaa zzz";

export function formatTaskDueDate(dueAt?: string | null): string | null {
  if (!dueAt) {
    return null;
  }

  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return formatInTimeZone(parsed, TASK_TIME_ZONE, TASK_TIME_FORMAT);
}

export function toTaskIsoString(dateTimeLocal: string): string | null {
  const trimmed = dateTimeLocal.trim();
  if (!trimmed) {
    return null;
  }

  const zonedDate = zonedTimeToUtc(trimmed, TASK_TIME_ZONE);
  if (Number.isNaN(zonedDate.getTime())) {
    return null;
  }

  return zonedDate.toISOString();
}
