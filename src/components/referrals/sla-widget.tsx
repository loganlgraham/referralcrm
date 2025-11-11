import { differenceInMinutes } from 'date-fns';

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

const minutesBetween = (start: Date | null, end: Date | null): number | null => {
  if (!start || !end) {
    return null;
  }

  const minutes = differenceInMinutes(end, start);
  return minutes >= 0 ? minutes : null;
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
