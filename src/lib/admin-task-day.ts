import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';

export const ADMIN_TASK_TIME_ZONE = 'America/Denver';
const DAY_KEY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DueDayBucket = 'overdue' | 'today' | 'upcoming';

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateTimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

export function getMountainDayKey(value: Date): string {
  return formatInTimeZone(value, ADMIN_TASK_TIME_ZONE, 'yyyy-MM-dd');
}

export function classifyDueDayBucket(dueAt: Date, now: Date = new Date()): DueDayBucket {
  const dueDayKey = getMountainDayKey(dueAt);
  const todayDayKey = getMountainDayKey(now);
  if (dueDayKey < todayDayKey) return 'overdue';
  if (dueDayKey > todayDayKey) return 'upcoming';
  return 'today';
}

export function getEightAmMountainDateTimeLocalForDay(dayKey: string): string {
  const match = DAY_KEY_REGEX.exec(dayKey);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const denverWallClock = new Date(year, month - 1, day, 8, 0, 0, 0);
  if (
    Number.isNaN(denverWallClock.getTime()) ||
    denverWallClock.getFullYear() !== year ||
    denverWallClock.getMonth() !== month - 1 ||
    denverWallClock.getDate() !== day
  ) {
    return '';
  }
  const utcDate = zonedTimeToUtc(denverWallClock, ADMIN_TASK_TIME_ZONE);
  return toDateTimeLocalValue(utcDate);
}

export function getTodayEightAmMountainDateTimeLocal(now: Date = new Date()): string {
  return getEightAmMountainDateTimeLocalForDay(getMountainDayKey(now));
}
