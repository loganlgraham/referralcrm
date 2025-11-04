import { differenceInHours, differenceInDays } from 'date-fns';

export function SLAWidget({ referral }: { referral: any }) {
  const createdAt = referral.createdAt ? new Date(referral.createdAt) : new Date();
  const firstContactAt = referral.audit?.find((entry: any) => entry.field === 'status' && entry.newValue === 'Contacted')?.timestamp;
  const contractAt = referral.audit?.find((entry: any) => entry.field === 'status' && entry.newValue === 'UC')?.timestamp;
  const closedAt = referral.audit?.find((entry: any) => entry.field === 'status' && entry.newValue === 'Closed')?.timestamp;

  const timeToFirstContact = firstContactAt ? differenceInHours(new Date(firstContactAt), createdAt) : null;
  const daysToContract = contractAt ? differenceInDays(new Date(contractAt), createdAt) : null;
  const daysToClose = closedAt ? differenceInDays(new Date(closedAt), createdAt) : null;

  const items = [
    { label: 'Time to First Contact', value: timeToFirstContact ? `${timeToFirstContact} hrs` : 'Pending' },
    { label: 'Days to Contract', value: daysToContract ? `${daysToContract} days` : 'Pending' },
    { label: 'Days to Close', value: daysToClose ? `${daysToClose} days` : 'Pending' }
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
