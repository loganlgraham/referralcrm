import {
  addDays,
  differenceInMinutes,
  eachDayOfInterval,
  isAfter,
  isBefore,
  isWeekend,
  max,
  min,
  set,
  startOfDay,
} from 'date-fns';
import { formatInTimeZone, utcToZonedTime } from 'date-fns-tz';

interface AuditEntry {
  field: string;
  newValue: string;
  timestamp?: string | Date;
}

interface DealEntry {
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  paidDate?: string | null;
}

const parseTimestamp = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  try {
    return new Date(value);
  } catch (error) {
    return null;
  }
};

const findFirstDealTimestamp = (deals: DealEntry[], status: string): Date | null => {
  const matches = deals
    .filter((deal) => deal.status === status)
    .map((deal) => {
      if (status === 'paid') {
        return (
          parseTimestamp(deal.paidDate) ??
          parseTimestamp(deal.updatedAt) ??
          parseTimestamp(deal.createdAt)
        );
      }
      if (status === 'closed') {
        return parseTimestamp(deal.updatedAt) ?? parseTimestamp(deal.createdAt);
      }
      return parseTimestamp(deal.createdAt) ?? parseTimestamp(deal.updatedAt);
    })
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime());

  return matches.length > 0 ? matches[0] : null;
};

const TIME_ZONE = 'America/Denver';
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 17;

const holidayCache = new Map<number, Set<string>>();

const formatDateKey = (date: Date): string => formatInTimeZone(date, TIME_ZONE, 'yyyy-MM-dd');

const addObservedHoliday = (date: Date, accumulator: Set<string>) => {
  const observedDate = (() => {
    const day = date.getDay();
    if (day === 0) {
      return addDays(date, 1);
    }
    if (day === 6) {
      return addDays(date, -1);
    }
    return date;
  })();

  accumulator.add(formatDateKey(observedDate));
};

const getNthWeekdayOfMonth = (year: number, month: number, weekday: number, nth: number): Date => {
  const firstOfMonth = new Date(year, month, 1);
  const offset = (7 + weekday - firstOfMonth.getDay()) % 7;
  const dayOfMonth = 1 + offset + (nth - 1) * 7;
  return new Date(year, month, dayOfMonth);
};

const getLastWeekdayOfMonth = (year: number, month: number, weekday: number): Date => {
  const lastOfMonth = new Date(year, month + 1, 0);
  const offset = (7 + lastOfMonth.getDay() - weekday) % 7;
  const dayOfMonth = lastOfMonth.getDate() - offset;
  return new Date(year, month, dayOfMonth);
};

const getHolidaySet = (year: number): Set<string> => {
  if (holidayCache.has(year)) {
    return holidayCache.get(year)!;
  }

  const holidays = new Set<string>();

  addObservedHoliday(new Date(year, 0, 1), holidays); // New Year's Day
  addObservedHoliday(getNthWeekdayOfMonth(year, 0, 1, 3), holidays); // Martin Luther King Jr. Day (3rd Monday January)
  addObservedHoliday(getNthWeekdayOfMonth(year, 1, 1, 3), holidays); // Presidents Day (3rd Monday February)
  addObservedHoliday(getLastWeekdayOfMonth(year, 4, 1), holidays); // Memorial Day (last Monday May)
  addObservedHoliday(new Date(year, 5, 19), holidays); // Juneteenth
  addObservedHoliday(new Date(year, 6, 4), holidays); // Independence Day
  addObservedHoliday(getNthWeekdayOfMonth(year, 8, 1, 1), holidays); // Labor Day (1st Monday September)
  addObservedHoliday(getNthWeekdayOfMonth(year, 9, 1, 2), holidays); // Indigenous Peoples' Day / Columbus Day (2nd Monday October)
  addObservedHoliday(new Date(year, 10, 11), holidays); // Veterans Day
  addObservedHoliday(getNthWeekdayOfMonth(year, 10, 4, 4), holidays); // Thanksgiving (4th Thursday November)
  addObservedHoliday(new Date(year, 11, 25), holidays); // Christmas Day

  holidayCache.set(year, holidays);
  return holidays;
};

const isHoliday = (date: Date): boolean => {
  const year = Number(formatInTimeZone(date, TIME_ZONE, 'yyyy'));
  const holidays = getHolidaySet(year);
  return holidays.has(formatDateKey(date));
};

const calculateBusinessMinutes = (start: Date, end: Date): number | null => {
  const zonedStart = utcToZonedTime(start, TIME_ZONE);
  const zonedEnd = utcToZonedTime(end, TIME_ZONE);

  if (isBefore(zonedEnd, zonedStart)) {
    return null;
  }

  const days = eachDayOfInterval({ start: zonedStart, end: zonedEnd });
  let totalMinutes = 0;

  days.forEach((day, index) => {
    if (isWeekend(day) || isHoliday(day)) {
      return;
    }

    const businessStart = set(startOfDay(day), {
      hours: BUSINESS_START_HOUR,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });
    const businessEnd = set(startOfDay(day), {
      hours: BUSINESS_END_HOUR,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    });

    const dayStart = index === 0 ? max([zonedStart, businessStart]) : businessStart;
    const dayEnd = index === days.length - 1 ? min([zonedEnd, businessEnd]) : businessEnd;

    if (isAfter(dayStart, businessEnd) || isBefore(dayEnd, businessStart)) {
      return;
    }

    const effectiveStart = max([dayStart, businessStart]);
    const effectiveEnd = min([dayEnd, businessEnd]);

    if (isAfter(effectiveEnd, effectiveStart) || effectiveEnd.getTime() === effectiveStart.getTime()) {
      const minutes = differenceInMinutes(effectiveEnd, effectiveStart);
      totalMinutes += Math.max(minutes, 0);
    }
  });

  return totalMinutes;
};

const minutesBetween = (start: Date | null, end: Date | null): number | null => {
  if (!start || !end) {
    return null;
  }

  return calculateBusinessMinutes(start, end);
};

const formatDuration = (minutes: number | null): string => {
  if (minutes === null) {
    return 'Pending';
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

export function SLAWidget({ referral }: { referral: any }) {
  const createdAt = parseTimestamp(referral.createdAt) ?? new Date();
  const statusAudit: AuditEntry[] = (referral.audit || []).filter((entry: AuditEntry) => entry.field === 'status');
  const sortedAudit = [...statusAudit].sort((a, b) => {
    const first = parseTimestamp(a.timestamp)?.getTime() ?? 0;
    const second = parseTimestamp(b.timestamp)?.getTime() ?? 0;
    return first - second;
  });

  const getFirstStatusTimestamp = (status: string): Date | null => {
    const match = sortedAudit.find((entry) => entry.newValue === status && entry.timestamp);
    if (match?.timestamp) {
      return parseTimestamp(match.timestamp);
    }

    if (referral.status === status && referral.statusLastUpdated) {
      return parseTimestamp(referral.statusLastUpdated);
    }

    return null;
  };

  const pairedAt = getFirstStatusTimestamp('Paired');
  const inCommunicationAt = getFirstStatusTimestamp('In Communication');
  const showingHomesAt = getFirstStatusTimestamp('Showing Homes');
  const underContractAt = getFirstStatusTimestamp('Under Contract');

  const deals: DealEntry[] = Array.isArray(referral.payments) ? referral.payments : [];

  const dealUnderContractAt =
    findFirstDealTimestamp(deals, 'under_contract') ?? underContractAt ?? pairedAt ?? createdAt;
  const dealClosedAt = findFirstDealTimestamp(deals, 'closed') ?? getFirstStatusTimestamp('Closed');
  const dealPaidAt = findFirstDealTimestamp(deals, 'paid');

  const newLeadToPaired = minutesBetween(createdAt, pairedAt);
  const pairedToCommunication = minutesBetween(pairedAt, inCommunicationAt);
  const communicationStart = showingHomesAt ?? inCommunicationAt ?? pairedAt ?? createdAt;
  const communicationToContract = minutesBetween(communicationStart, underContractAt);
  const contractToClose = minutesBetween(dealUnderContractAt, dealClosedAt);
  const closeToPaid = minutesBetween(dealClosedAt, dealPaidAt);

  const items = [
    {
      label: 'New Lead → Paired',
      value: formatDuration(newLeadToPaired),
    },
    {
      label: 'Paired → Communicating',
      value: formatDuration(pairedToCommunication),
    },
    {
      label: 'Communicating → Under Contract',
      value: formatDuration(communicationToContract),
    },
    {
      label: 'Deal: Under Contract → Closed',
      value: formatDuration(contractToClose),
    },
    {
      label: 'Deal: Closed → Paid',
      value: formatDuration(closeToPaid),
    },
  ];

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Speed to serve</h2>
        <p className="text-xs text-slate-500">Time between key milestones in this referral journey.</p>
      </div>
      <dl className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <dt className="text-slate-500">{item.label}</dt>
            <dd className="font-medium text-slate-900">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
