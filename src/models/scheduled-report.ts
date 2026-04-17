import { Schema, model, models, type Model, type Types } from 'mongoose';

export type ScheduledReportCadence = 'daily' | 'weekly' | 'monthly';

export interface ScheduledReportDocument {
  _id: Types.ObjectId;
  name: string;
  reportName: string;
  reportTimeframe: string;
  customStartDate?: string | null;
  customEndDate?: string | null;
  metrics: string[];
  network: 'ALL' | 'AHA' | 'AHA_OOS';
  recipients: string[];
  cadence: ScheduledReportCadence;
  attachCsv: boolean;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledReportSchema = new Schema<ScheduledReportDocument>(
  {
    name: { type: String, required: true, trim: true },
    reportName: { type: String, required: true, trim: true },
    reportTimeframe: { type: String, required: true, default: 'This month' },
    customStartDate: { type: String, default: null },
    customEndDate: { type: String, default: null },
    metrics: { type: [String], required: true, default: [] },
    network: { type: String, enum: ['ALL', 'AHA', 'AHA_OOS'], default: 'ALL' },
    recipients: { type: [String], required: true, default: [] },
    cadence: { type: String, enum: ['daily', 'weekly', 'monthly'], required: true },
    attachCsv: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true, index: true },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, required: true, index: true },
    createdBy: { type: String, default: null }
  },
  { timestamps: true }
);

scheduledReportSchema.index({ enabled: 1, nextRunAt: 1 });

export const ScheduledReport: Model<ScheduledReportDocument> =
  (models.ScheduledReport as Model<ScheduledReportDocument>) ||
  model<ScheduledReportDocument>('ScheduledReport', scheduledReportSchema);

const MT_TZ = 'America/Denver';
const RUN_HOUR_LOCAL = 7;

/**
 * Compute the next run timestamp for a cadence, anchored to 7am America/Denver.
 * - daily   -> next 7am MT after `from`
 * - weekly  -> next Monday 7am MT after `from`
 * - monthly -> next 1st-of-month 7am MT after `from`
 */
export function computeNextRunAt(cadence: ScheduledReportCadence, from: Date = new Date()): Date {
  const local = getMtComponents(from);
  let candidate = mtComponentsToUtc({
    year: local.year,
    month: local.month,
    day: local.day,
    hour: RUN_HOUR_LOCAL,
    minute: 0,
    second: 0
  });

  // Walk forward by 1 day at a time until we satisfy cadence + future constraints.
  // Capped to a year of iterations as a safety net.
  for (let i = 0; i < 400; i += 1) {
    const candidateLocal = getMtComponents(candidate);
    const cadenceMatches =
      cadence === 'daily' ||
      (cadence === 'weekly' && candidateLocal.weekday === 1) ||
      (cadence === 'monthly' && candidateLocal.day === 1);
    if (candidate > from && cadenceMatches) {
      return candidate;
    }
    candidate = mtComponentsToUtc({
      year: candidateLocal.year,
      month: candidateLocal.month,
      day: candidateLocal.day + 1,
      hour: RUN_HOUR_LOCAL,
      minute: 0,
      second: 0
    });
  }

  return candidate;
}

type MtComponents = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun..6=Sat
};

function getMtComponents(date: Date): MtComponents {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false
  });
  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday] ?? 0
  };
}

function mtComponentsToUtc(components: Pick<MtComponents, 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second'>): Date {
  // First-pass guess: treat the MT clock components as if they were UTC to get a rough instant.
  const utcGuess = Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second
  );
  // Compute the UTC offset that America/Denver has at that approximate instant. mtOffsetMs returns
  // a positive number of milliseconds (UTC is `offset` ahead of MT), so add it to the guess to
  // recover the true UTC instant. Re-evaluate once to pick up DST boundaries cleanly.
  const offsetMs = mtOffsetMs(new Date(utcGuess));
  const firstPass = utcGuess + offsetMs;
  const offsetMs2 = mtOffsetMs(new Date(firstPass));
  return new Date(utcGuess + offsetMs2);
}

function mtOffsetMs(date: Date): number {
  // Returns America/Denver offset relative to UTC at `date`, in milliseconds.
  // Positive when MT is behind UTC (always the case in continental US).
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: MT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return date.getTime() - asUtcMs;
}

