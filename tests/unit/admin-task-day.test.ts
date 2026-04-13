import { describe, expect, it } from '@jest/globals';
import { formatInTimeZone } from 'date-fns-tz';

import {
  ADMIN_TASK_TIME_ZONE,
  classifyDueDayBucket,
  getEightAmMountainDateTimeLocalForDay,
  getTodayEightAmMountainDateTimeLocal,
} from '@/lib/admin-task-day';

describe('admin-task-day', () => {
  describe('classifyDueDayBucket', () => {
    it('treats due dates later on the same Denver day as today', () => {
      const now = new Date('2026-04-13T22:30:00Z'); // Apr 13 in Denver
      const dueLaterSameDenverDay = new Date('2026-04-14T03:30:00Z'); // Apr 13 in Denver

      expect(classifyDueDayBucket(dueLaterSameDenverDay, now)).toBe('today');
    });

    it('classifies prior Denver day as overdue', () => {
      const now = new Date('2026-04-13T22:30:00Z');
      const dueYesterdayDenver = new Date('2026-04-13T05:00:00Z');

      expect(classifyDueDayBucket(dueYesterdayDenver, now)).toBe('overdue');
    });

    it('classifies next Denver day as upcoming', () => {
      const now = new Date('2026-04-13T22:30:00Z');
      const dueTomorrowDenver = new Date('2026-04-14T18:00:00Z');

      expect(classifyDueDayBucket(dueTomorrowDenver, now)).toBe('upcoming');
    });
  });

  describe('getEightAmMountainDateTimeLocalForDay', () => {
    it('returns a datetime-local value that maps to 8:00 AM Denver during MST', () => {
      const value = getEightAmMountainDateTimeLocalForDay('2026-01-15');
      const asDate = new Date(value);

      expect(formatInTimeZone(asDate, ADMIN_TASK_TIME_ZONE, 'yyyy-MM-dd HH:mm')).toBe(
        '2026-01-15 08:00'
      );
    });

    it('returns a datetime-local value that maps to 8:00 AM Denver during MDT', () => {
      const value = getEightAmMountainDateTimeLocalForDay('2026-07-15');
      const asDate = new Date(value);

      expect(formatInTimeZone(asDate, ADMIN_TASK_TIME_ZONE, 'yyyy-MM-dd HH:mm')).toBe(
        '2026-07-15 08:00'
      );
    });

    it('returns an empty value for invalid day keys', () => {
      expect(getEightAmMountainDateTimeLocalForDay('2026/07/15')).toBe('');
      expect(getEightAmMountainDateTimeLocalForDay('2026-02-31')).toBe('');
    });
  });

  describe('getTodayEightAmMountainDateTimeLocal', () => {
    it('uses the supplied current date to determine Denver day', () => {
      const value = getTodayEightAmMountainDateTimeLocal(new Date('2026-04-14T05:30:00Z'));
      const asDate = new Date(value);

      expect(formatInTimeZone(asDate, ADMIN_TASK_TIME_ZONE, 'yyyy-MM-dd HH:mm')).toBe(
        '2026-04-13 08:00'
      );
    });
  });
});
