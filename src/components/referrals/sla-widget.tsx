import { differenceInDays, differenceInHours } from 'date-fns';

interface AuditEntry {
  field: string;
  newValue: string;
  timestamp?: string | Date;
}

export function SLAWidget({ referral }: { referral: any }) {
  const createdAt = referral.createdAt ? new Date(referral.createdAt) : new Date();
  const statusAudit: AuditEntry[] = (referral.audit || []).filter((entry: AuditEntry) => entry.field === 'status');
  const sortedAudit = [...statusAudit].sort((a, b) => {
    const first = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const second = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return first - second;
  });

  const getFirstStatusTimestamp = (status: string): Date | null => {
    const match = sortedAudit.find((entry) => entry.newValue === status && entry.timestamp);
    return match?.timestamp ? new Date(match.timestamp) : null;
  };

  const firstContactAt = getFirstStatusTimestamp('In Communication');
  const contractAt = getFirstStatusTimestamp('Under Contract');
  const closedAt = getFirstStatusTimestamp('Closed');

  const timeToFirstContact = firstContactAt ? Math.max(0, differenceInHours(firstContactAt, createdAt)) : null;
  const daysToContract = contractAt ? Math.max(0, differenceInDays(contractAt, createdAt)) : null;
  const daysToClose = closedAt ? Math.max(0, differenceInDays(closedAt, contractAt ?? createdAt)) : null;

  const items = [
    { label: 'Time to First Contact', value: timeToFirstContact !== null ? `${timeToFirstContact} hrs` : 'Pending' },
    { label: 'Days to Contract', value: daysToContract !== null ? `${daysToContract} days` : 'Pending' },
    { label: 'Days to Close', value: daysToClose !== null ? `${daysToClose} days` : 'Pending' }
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
