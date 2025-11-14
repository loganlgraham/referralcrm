import {
  addDays,
  addHours,
  differenceInDays,
  differenceInHours,
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

interface AuditEntryLike {
  field?: string;
  newValue?: string;
  timestamp?: string | Date;
}

interface DealLike {
  status?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  paidDate?: string | Date | null;
}

interface NoteLike {
  createdAt?: string | Date;
}

export interface SlaDuration {
  key: string;
  label: string;
  minutes: number | null;
  formatted: string;
}

export type RecommendationPriority = 'urgent' | 'high' | 'medium' | 'low';

export interface SlaRecommendation {
  id: string;
  title: string;
  message: string;
  priority: RecommendationPriority;
  category: 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';
  dueAt?: string | null;
  supportingMetric?: string;
}

export interface SlaInsights {
  durations: SlaDuration[];
  recommendations: SlaRecommendation[];
  riskSummary: {
    level: 'on_track' | 'watch' | 'at_risk';
    headline: string;
    detail: string;
  } | null;
}

export interface ReferralLike {
  _id: string;
  createdAt?: string | Date;
  status?: string;
  statusLastUpdated?: string | Date | null;
  daysInStatus?: number;
  assignedAgent?: { name?: string | null; fullName?: string | null } | null;
  assignedAgentName?: string;
  lender?: { name?: string | null } | null;
  origin?: 'agent' | 'mc' | 'admin';
  borrower?: { name?: string };
  notes?: NoteLike[];
  payments?: DealLike[];
  audit?: AuditEntryLike[];
  sla?: {
    contractToCloseMinutes?: number | null;
    closedToPaidMinutes?: number | null;
    previousContractToCloseMinutes?: number | null;
    previousClosedToPaidMinutes?: number | null;
  } | null;
}

const TIME_ZONE = 'America/Denver';
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 17;

const PRE_CONTRACT_STATUSES = new Set(['New Lead', 'Paired', 'In Communication', 'Showing Homes']);

const SLA_THRESHOLDS = {
  minutesToAssignment: 120,
  hoursToFirstConversation: 24,
  daysToUnderContract: 14,
  daysToClose: 45,
  daysWithoutTouchPoint: 3,
  daysToPaymentAfterClose: 10,
};

const holidayCache = new Map<number, Set<string>>();

export const parseTimestamp = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  try {
    return new Date(value);
  } catch (error) {
    return null;
  }
};

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

  addObservedHoliday(new Date(year, 0, 1), holidays);
  addObservedHoliday(getNthWeekdayOfMonth(year, 0, 1, 3), holidays);
  addObservedHoliday(getNthWeekdayOfMonth(year, 1, 1, 3), holidays);
  addObservedHoliday(getLastWeekdayOfMonth(year, 4, 1), holidays);
  addObservedHoliday(new Date(year, 5, 19), holidays);
  addObservedHoliday(new Date(year, 6, 4), holidays);
  addObservedHoliday(getNthWeekdayOfMonth(year, 8, 1, 1), holidays);
  addObservedHoliday(getNthWeekdayOfMonth(year, 9, 1, 2), holidays);
  addObservedHoliday(new Date(year, 10, 11), holidays);
  addObservedHoliday(getNthWeekdayOfMonth(year, 10, 4, 4), holidays);
  addObservedHoliday(new Date(year, 11, 25), holidays);

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

const formatMinutesValue = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
};

const formatDuration = (minutes: number | null, previous?: number | null): string => {
  if (minutes === null) {
    if (previous != null) {
      return `Pending (prev ${formatMinutesValue(previous)})`;
    }
    return 'Pending';
  }

  return formatMinutesValue(minutes);
};

const findFirstDealTimestamp = (deals: DealLike[], statuses: string | string[]): Date | null => {
  const targets = Array.isArray(statuses) ? new Set(statuses) : new Set([statuses]);
  const matches = deals
    .filter((deal) => deal.status && targets.has(deal.status))
    .map((deal) => {
      const status = deal.status ?? '';
      if (status === 'paid') {
        return parseTimestamp(deal.paidDate) ?? parseTimestamp(deal.updatedAt) ?? parseTimestamp(deal.createdAt);
      }
      if (status === 'closed' || status === 'payment_sent') {
        return parseTimestamp(deal.updatedAt) ?? parseTimestamp(deal.createdAt);
      }
      return parseTimestamp(deal.createdAt) ?? parseTimestamp(deal.updatedAt);
    })
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime());

  return matches.length > 0 ? matches[0] : null;
};

const sortStatusAudit = (audit: AuditEntryLike[]): AuditEntryLike[] => {
  return [...audit]
    .filter((entry) => entry.field === 'status')
    .sort((a, b) => {
      const first = parseTimestamp(a.timestamp)?.getTime() ?? 0;
      const second = parseTimestamp(b.timestamp)?.getTime() ?? 0;
      return first - second;
    });
};

const buildStatusLookup = (referral: ReferralLike, audit: AuditEntryLike[]): ((status: string) => Date | null) => {
  const sortedAudit = sortStatusAudit(audit);
  return (status: string) => {
    const match = sortedAudit.find((entry) => entry.newValue === status && entry.timestamp);
    if (match?.timestamp) {
      return parseTimestamp(match.timestamp);
    }

    if (referral.status === status && referral.statusLastUpdated) {
      return parseTimestamp(referral.statusLastUpdated);
    }

    return null;
  };
};

const getLatestNoteTimestamp = (notes: NoteLike[] | undefined): Date | null => {
  if (!Array.isArray(notes) || notes.length === 0) {
    return null;
  }
  const timestamps = notes
    .map((note) => parseTimestamp(note.createdAt))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => b.getTime() - a.getTime());

  return timestamps[0] ?? null;
};

export const computeSlaDurations = (referral: ReferralLike): SlaDuration[] => {
  const createdAt = parseTimestamp(referral.createdAt) ?? new Date();
  const auditEntries = Array.isArray(referral.audit) ? referral.audit : [];
  const getFirstStatusTimestamp = buildStatusLookup(referral, auditEntries);
  const pairedAt = getFirstStatusTimestamp('Paired');
  const inCommunicationAt = getFirstStatusTimestamp('In Communication');
  const showingHomesAt = getFirstStatusTimestamp('Showing Homes');
  const underContractAt = getFirstStatusTimestamp('Under Contract');

  const deals: DealLike[] = Array.isArray(referral.payments) ? referral.payments : [];
  const storedContractToClose = referral.sla?.contractToCloseMinutes ?? null;
  const storedClosedToPaid = referral.sla?.closedToPaidMinutes ?? null;
  const previousContractToClose = referral.sla?.previousContractToCloseMinutes ?? null;
  const previousClosedToPaid = referral.sla?.previousClosedToPaidMinutes ?? null;
  const activeDealStatuses = new Set([
    'under_contract',
    'past_inspection',
    'past_appraisal',
    'clear_to_close',
    'closed',
    'payment_sent',
    'paid',
  ]);
  const hasDealProgress = deals.some((deal) => deal.status && activeDealStatuses.has(deal.status));
  const activeReferralStatuses = new Set([
    'Under Contract',
    'Closed',
    'Payment Sent',
    'Clear to Close',
    'Past Inspection',
    'Past Appraisal',
  ]);
  const isCurrentlyContracting = referral.status && activeReferralStatuses.has(referral.status);
  const isPreContractStatus = referral.status ? PRE_CONTRACT_STATUSES.has(referral.status) : false;

  const dealUnderContractAt = hasDealProgress || isCurrentlyContracting
    ? findFirstDealTimestamp(deals, [
        'under_contract',
        'past_inspection',
        'past_appraisal',
        'clear_to_close',
        'closed',
        'payment_sent',
        'paid',
      ]) ?? underContractAt ?? pairedAt ?? createdAt
    : null;
  const dealClosedAt = findFirstDealTimestamp(deals, ['closed', 'payment_sent', 'paid']) ?? getFirstStatusTimestamp('Closed');
  const dealPaidAt = findFirstDealTimestamp(deals, 'paid');

  const newLeadToPaired = minutesBetween(createdAt, pairedAt);
  const pairedToCommunication = minutesBetween(pairedAt, inCommunicationAt);
  const communicationStart = showingHomesAt ?? inCommunicationAt ?? pairedAt ?? createdAt;
  const communicationToContract = minutesBetween(communicationStart, underContractAt);
  const contractToClose = minutesBetween(dealUnderContractAt, dealClosedAt);
  const closeToPaid = minutesBetween(dealClosedAt, dealPaidAt);

  const contractToCloseMinutes = isPreContractStatus
    ? null
    : contractToClose ?? storedContractToClose ?? null;
  const closeToPaidMinutes = isPreContractStatus
    ? null
    : closeToPaid ?? storedClosedToPaid ?? null;

  const contractToClosePrevious = isPreContractStatus
    ? previousContractToClose ?? storedContractToClose ?? null
    : previousContractToClose ?? null;
  const closeToPaidPrevious = isPreContractStatus
    ? previousClosedToPaid ?? storedClosedToPaid ?? null
    : previousClosedToPaid ?? null;

  const durations: SlaDuration[] = [
    {
      key: 'new-lead-to-paired',
      label: 'New Lead → Paired',
      minutes: newLeadToPaired,
      formatted: formatDuration(newLeadToPaired),
    },
    {
      key: 'paired-to-communication',
      label: 'Paired → Communicating',
      minutes: pairedToCommunication,
      formatted: formatDuration(pairedToCommunication),
    },
    {
      key: 'communication-to-contract',
      label: 'Communicating → Under Contract',
      minutes: communicationToContract,
      formatted: formatDuration(communicationToContract),
    },
    {
      key: 'contract-to-close',
      label: 'Deal: Under Contract → Closed',
      minutes: contractToCloseMinutes,
      formatted: formatDuration(contractToCloseMinutes, contractToClosePrevious),
    },
    {
      key: 'close-to-paid',
      label: 'Deal: Closed → Paid',
      minutes: closeToPaidMinutes,
      formatted: formatDuration(closeToPaidMinutes, closeToPaidPrevious),
    },
  ];

  if (referral.origin === 'agent') {
    return durations.filter((item) => item.key !== 'close-to-paid');
  }

  return durations;
};

const buildRecommendation = (
  recommendation: Omit<SlaRecommendation, 'id'> & { id: string }
): SlaRecommendation => recommendation;

const minDueDate = (candidate: Date | null | undefined): string | null => {
  if (!candidate) {
    return null;
  }
  return candidate.toISOString();
};

const computeAgentReferralRecommendations = (referral: ReferralLike): SlaRecommendation[] => {
  const createdAt = parseTimestamp(referral.createdAt) ?? new Date();
  const now = new Date();
  const status = referral.status ?? 'New Lead';
  const statusLastUpdated = parseTimestamp(referral.statusLastUpdated) ?? createdAt;
  const hoursSinceStatusUpdate = differenceInHours(now, statusLastUpdated);
  const latestNoteAt = getLatestNoteTimestamp(referral.notes);
  const hoursSinceLastNote = latestNoteAt ? differenceInHours(now, latestNoteAt) : null;

  const recommendations: SlaRecommendation[] = [];

  if (!referral.lender) {
    const dueBy = addHours(createdAt, 1);
    recommendations.push(
      buildRecommendation({
        id: 'assign-mc-agent-origin',
        title: 'Assign a mortgage consultant',
        message: 'Choose the MC who will take this referral so they can contact the borrower without delay.',
        priority: 'urgent',
        category: 'assignment',
        dueAt: minDueDate(dueBy),
        supportingMetric: 'Awaiting MC assignment',
      })
    );
  }

  if (referral.lender && (status === 'New Lead' || status === 'Paired') && hoursSinceStatusUpdate >= 4) {
    const dueBy = addHours(statusLastUpdated, 4);
    recommendations.push(
      buildRecommendation({
        id: 'confirm-borrower-intro',
        title: 'Confirm borrower outreach',
        message: 'Make sure the MC has introduced themselves to the borrower and acknowledged the referral.',
        priority: 'high',
        category: 'communication',
        dueAt: minDueDate(dueBy),
        supportingMetric: `${hoursSinceStatusUpdate}h since transfer`,
      })
    );
  }

  if (hoursSinceLastNote !== null && hoursSinceLastNote > 48) {
    recommendations.push(
      buildRecommendation({
        id: 'share-agent-update',
        title: 'Share an update with the referring agent',
        message: 'Log a quick note so the referring agent knows how the borrower conversation is progressing.',
        priority: 'medium',
        category: 'communication',
        supportingMetric: `Last update ${hoursSinceLastNote}h ago`,
      })
    );
  }

  if (status === 'In Communication' && hoursSinceStatusUpdate >= 72) {
    const dueBy = addHours(statusLastUpdated, 72);
    recommendations.push(
      buildRecommendation({
        id: 'plan-next-step',
        title: 'Plan the borrower’s next milestone',
        message: 'Suggest documents, education, or follow-ups to keep the borrower moving forward.',
        priority: 'medium',
        category: 'pipeline',
        dueAt: minDueDate(dueBy),
        supportingMetric: `${hoursSinceStatusUpdate}h in current stage`,
      })
    );
  }

  return recommendations;
};

export const computeSlaRecommendations = (referral: ReferralLike): SlaRecommendation[] => {
  if (referral.origin === 'agent') {
    return computeAgentReferralRecommendations(referral);
  }
  const createdAt = parseTimestamp(referral.createdAt) ?? new Date();
  const now = new Date();
  const durations = computeSlaDurations(referral);
  const assignmentsMinutes = durations.find((item) => item.key === 'new-lead-to-paired')?.minutes;
  const communicationMinutes = durations.find((item) => item.key === 'paired-to-communication')?.minutes;
  const underContractMinutes = durations.find((item) => item.key === 'communication-to-contract')?.minutes;
  const closedMinutes = durations.find((item) => item.key === 'contract-to-close')?.minutes;
  const paidMinutes = durations.find((item) => item.key === 'close-to-paid')?.minutes;

  const status = referral.status ?? 'New Lead';
  const assignedAgentName =
    referral.assignedAgent?.name ??
    referral.assignedAgent?.fullName ??
    referral.assignedAgentName ??
    undefined;

  const statusLastUpdated = parseTimestamp(referral.statusLastUpdated) ?? createdAt;
  const statusAgeDays =
    referral.daysInStatus ?? differenceInDays(now, statusLastUpdated);
  const hoursSinceStatusUpdate = differenceInHours(now, statusLastUpdated);

  const latestNoteAt = getLatestNoteTimestamp(referral.notes);
  const hoursSinceLastNote = latestNoteAt ? differenceInHours(now, latestNoteAt) : null;

  const recommendations: SlaRecommendation[] = [];

  if (!assignedAgentName) {
    const dueBy = addHours(createdAt, SLA_THRESHOLDS.minutesToAssignment / 60);
    recommendations.push(
      buildRecommendation({
        id: 'assign-agent',
        title: 'Assign an agent',
        message: 'No partner agent is assigned. Route this referral before the SLA breach.',
        priority: 'urgent',
        category: 'assignment',
        dueAt: minDueDate(dueBy),
        supportingMetric: 'Assignment SLA: 2 hours',
      })
    );
  } else if (status === 'New Lead' && (!assignmentsMinutes || assignmentsMinutes > SLA_THRESHOLDS.minutesToAssignment)) {
    const dueBy = addHours(statusLastUpdated, SLA_THRESHOLDS.minutesToAssignment / 60);
    recommendations.push(
      buildRecommendation({
        id: 'coach-initial-outreach',
        title: 'Confirm first touchpoint',
        message: 'It has taken longer than 2 hours to connect. Confirm the agent reached out to the borrower.',
        priority: 'high',
        category: 'communication',
        dueAt: minDueDate(dueBy),
        supportingMetric: `Current lead-to-pairing: ${assignmentsMinutes ? formatDuration(assignmentsMinutes) : 'Pending'}`,
      })
    );
  }

  if (status === 'Paired') {
    if (hoursSinceStatusUpdate > SLA_THRESHOLDS.hoursToFirstConversation) {
      const dueBy = addHours(statusLastUpdated, SLA_THRESHOLDS.hoursToFirstConversation);
      recommendations.push(
        buildRecommendation({
          id: 'nudge-first-conversation',
          title: 'Prompt first borrower conversation',
          message: 'Follow up with the agent to ensure they have scheduled an introduction call.',
          priority: 'high',
          category: 'communication',
          dueAt: minDueDate(dueBy),
          supportingMetric: `Hours since paired: ${hoursSinceStatusUpdate}`,
        })
      );
    }
    if (!communicationMinutes) {
      recommendations.push(
        buildRecommendation({
          id: 'log-communication-update',
          title: 'Capture communication progress',
          message: 'Record a timeline update once the agent makes contact so SLA tracking stays accurate.',
          priority: 'medium',
          category: 'ops',
          supportingMetric: 'Awaiting communication milestone',
        })
      );
    }
  }

  if (status === 'In Communication' || status === 'Showing Homes') {
    if (statusAgeDays >= SLA_THRESHOLDS.daysWithoutTouchPoint) {
      const dueBy = addDays(statusLastUpdated, SLA_THRESHOLDS.daysWithoutTouchPoint);
      recommendations.push(
        buildRecommendation({
          id: 'schedule-proactive-check-in',
          title: 'Schedule a proactive check-in',
          message: 'It has been a few days without movement. Suggest next steps or resources to keep momentum.',
          priority: 'medium',
          category: 'communication',
          dueAt: minDueDate(dueBy),
          supportingMetric: `${statusAgeDays} days in current stage`,
        })
      );
    }
    if (hoursSinceLastNote !== null && hoursSinceLastNote > 48) {
      recommendations.push(
        buildRecommendation({
          id: 'refresh-activity-log',
          title: 'Update the activity log',
          message: 'Log a quick note or call outcome so the team has the latest borrower context.',
          priority: 'low',
          category: 'ops',
          supportingMetric: `Last note ${hoursSinceLastNote}h ago`,
        })
      );
    }
  }

  if (status === 'Showing Homes' || status === 'In Communication') {
    if (!underContractMinutes && statusAgeDays >= SLA_THRESHOLDS.daysToUnderContract) {
      const dueBy = addDays(statusLastUpdated, SLA_THRESHOLDS.daysToUnderContract);
      recommendations.push(
        buildRecommendation({
          id: 'review-conversion-plan',
          title: 'Review conversion plan',
          message: 'Share open houses, financing refreshers, or incentives to help the borrower move forward.',
          priority: 'medium',
          category: 'pipeline',
          dueAt: minDueDate(dueBy),
          supportingMetric: `${statusAgeDays} days without contract`,
        })
      );
    }
  }

  if (status === 'Under Contract') {
    if (!closedMinutes && statusAgeDays >= SLA_THRESHOLDS.daysToClose) {
      const dueBy = addDays(statusLastUpdated, SLA_THRESHOLDS.daysToClose);
      recommendations.push(
        buildRecommendation({
          id: 'check-escrow-milestones',
          title: 'Check escrow milestones',
          message: 'Confirm appraisal, inspection, and financing checkpoints are on track to avoid delays.',
          priority: 'high',
          category: 'pipeline',
          dueAt: minDueDate(dueBy),
          supportingMetric: `${statusAgeDays} days since contract`,
        })
      );
    }
  }

  if (status === 'Closed') {
    if (!paidMinutes || paidMinutes / 60 / 24 > SLA_THRESHOLDS.daysToPaymentAfterClose) {
      const dueBy = addDays(statusLastUpdated, SLA_THRESHOLDS.daysToPaymentAfterClose);
      recommendations.push(
        buildRecommendation({
          id: 'confirm-referral-fee',
          title: 'Confirm referral fee payment',
          message: 'Closed files should have invoices tracked. Verify the payment status and log receipt.',
          priority: 'medium',
          category: 'finance',
          dueAt: minDueDate(dueBy),
          supportingMetric: 'Awaiting payment confirmation',
        })
      );
    }
  }

  if ((status === 'Terminated' || status === 'Lost') && hoursSinceLastNote !== null && hoursSinceLastNote > 24) {
    recommendations.push(
      buildRecommendation({
        id: 'capture-termination-reason',
        title: 'Capture termination context',
        message: 'Document the reason for termination to inform performance analytics and follow-up campaigns.',
        priority: 'medium',
        category: 'ops',
        supportingMetric: `Last note ${hoursSinceLastNote}h ago`,
      })
    );
  }

  return recommendations;
};

export const computeRiskSummary = (referral: ReferralLike, recommendations: SlaRecommendation[]): SlaInsights['riskSummary'] => {
  if (recommendations.length === 0) {
    return {
      level: 'on_track',
      headline: 'All milestones are on track',
      detail: 'SLA clocks are healthy and no proactive outreach is required right now.',
    };
  }

  const hasUrgent = recommendations.some((item) => item.priority === 'urgent');
  const hasHigh = recommendations.some((item) => item.priority === 'high');

  if (hasUrgent) {
    return {
      level: 'at_risk',
      headline: 'Critical SLA risk detected',
      detail: 'Immediate attention is needed to protect this referral before SLAs are breached.',
    };
  }

  if (hasHigh) {
    return {
      level: 'watch',
      headline: 'Important follow-ups recommended',
      detail: 'Address the recommended actions soon to keep the borrower journey on track.',
    };
  }

  return {
    level: 'on_track',
    headline: 'Minor optimizations available',
    detail: 'Consider the suggested touchpoints to keep momentum with the borrower.',
  };
};

export const computeSlaInsights = (referral: ReferralLike): SlaInsights => {
  const durations = computeSlaDurations(referral);
  const recommendations = computeSlaRecommendations(referral);
  const riskSummary = computeRiskSummary(referral, recommendations);

  return {
    durations,
    recommendations,
    riskSummary,
  };
};

export const sortRecommendations = (items: SlaRecommendation[]): SlaRecommendation[] => {
  const priorityWeight: Record<RecommendationPriority, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return [...items].sort((a, b) => {
    const priorityDiff = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const aDue = a.dueAt ? parseTimestamp(a.dueAt)?.getTime() ?? Infinity : Infinity;
    const bDue = b.dueAt ? parseTimestamp(b.dueAt)?.getTime() ?? Infinity : Infinity;

    return aDue - bDue;
  });
};

