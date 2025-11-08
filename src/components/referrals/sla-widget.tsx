import { differenceInDays, differenceInHours } from 'date-fns';

interface AuditEntry {
  field: string;
  newValue: string;
  timestamp?: string | Date;
}

interface DealEntry {
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
    .map((deal) => parseTimestamp(deal.updatedAt) ?? parseTimestamp(deal.createdAt))
    .filter((value): value is Date => Boolean(value))
    .sort((a, b) => a.getTime() - b.getTime());

  return matches.length > 0 ? matches[0] : null;
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
  const dealUnderContractAt = findFirstDealTimestamp(deals, 'under_contract') ?? underContractAt;
  const dealClosedAt = findFirstDealTimestamp(deals, 'closed');
  const dealPaidAt = findFirstDealTimestamp(deals, 'paid');

  const newLeadToPaired = pairedAt ? Math.max(0, differenceInHours(pairedAt, createdAt)) : null;
  const pairedToCommunication = pairedAt && inCommunicationAt
    ? Math.max(0, differenceInHours(inCommunicationAt, pairedAt))
    : null;
  const communicationStart = showingHomesAt ?? inCommunicationAt ?? pairedAt ?? createdAt;
  const communicationToContract =
    communicationStart && underContractAt
      ? Math.max(0, differenceInDays(underContractAt, communicationStart))
      : null;
  const contractToClose =
    dealUnderContractAt && dealClosedAt
      ? Math.max(0, differenceInDays(dealClosedAt, dealUnderContractAt))
      : null;
  const closeToPaid =
    dealClosedAt && dealPaidAt ? Math.max(0, differenceInDays(dealPaidAt, dealClosedAt)) : null;

  const items = [
    {
      label: 'New Lead → Paired',
      value: newLeadToPaired !== null ? `${newLeadToPaired} hrs` : 'Pending',
    },
    {
      label: 'Paired → In Communication',
      value: pairedToCommunication !== null ? `${pairedToCommunication} hrs` : 'Pending',
    },
    {
      label: 'In Communication → Under Contract',
      value: communicationToContract !== null ? `${communicationToContract} days` : 'Pending',
    },
    {
      label: 'Deal: Under Contract → Closed',
      value: contractToClose !== null ? `${contractToClose} days` : 'Pending',
    },
    {
      label: 'Deal: Closed → Paid',
      value: closeToPaid !== null ? `${closeToPaid} days` : 'Pending',
    },
  ];

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 p-4">
      <p className="text-xs uppercase text-slate-400">SLA Clocks</p>
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between text-sm">
          <span className="text-slate-500">{item.label}</span>
          <span className="font-medium text-slate-900">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
