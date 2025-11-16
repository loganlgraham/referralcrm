import Link from 'next/link';

import { DEAL_STATUS_LABELS, type DealStatus } from '@/constants/deals';
import { formatCurrency } from '@/utils/formatters';

export interface PersonDealSummary {
  id: string;
  referralId: string;
  borrowerName: string | null;
  loanFileNumber: string | null;
  propertyAddress: string | null;
  status: DealStatus | string | null;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  usedAfc?: boolean | null;
  usedAssignedAgent?: boolean | null;
  updatedAt?: string | null;
  agent?: {
    id: string;
    name: string | null;
  } | null;
}

interface PersonDealsTableProps {
  deals: PersonDealSummary[];
  context: 'agent' | 'mc';
}

const getStatusLabel = (status: PersonDealSummary['status']): string => {
  if (!status) {
    return '—';
  }

  const normalized = status as DealStatus;
  return DEAL_STATUS_LABELS[normalized] ?? status;
};

const computeOutcome = (deal: PersonDealSummary, context: 'agent' | 'mc'): 'Won' | 'Lost' | 'Pending' => {
  if (deal.status === 'terminated') {
    return 'Lost';
  }

  const basis = context === 'mc' ? deal.usedAfc : deal.usedAssignedAgent;
  if (basis === null || basis === undefined) {
    return 'Pending';
  }

  return basis ? 'Won' : 'Lost';
};

const outcomeClassName = (outcome: 'Won' | 'Lost' | 'Pending'): string => {
  if (outcome === 'Won') {
    return 'text-emerald-600';
  }
  if (outcome === 'Lost') {
    return 'text-rose-600';
  }
  return 'text-slate-500';
};

export function PersonDealsTable({ deals, context }: PersonDealsTableProps) {
  if (!Array.isArray(deals) || deals.length === 0) {
    return <p className="text-sm text-slate-500">No deals recorded yet.</p>;
  }

  const showAgentColumn = context === 'mc' && deals.some((deal) => deal.agent?.id);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Outcome</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Expected</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Received</th>
            {showAgentColumn && (
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Agent</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {deals.map((deal) => {
            const outcome = computeOutcome(deal, context);
            const outcomeColor = outcomeClassName(outcome);
            const expectedCents = deal.expectedAmountCents ?? 0;
            const receivedCents = deal.receivedAmountCents ?? 0;
            const label = deal.borrowerName?.trim() || 'Referral';
            const detail = deal.propertyAddress?.trim()
              ? deal.propertyAddress
              : deal.loanFileNumber
              ? `Loan # ${deal.loanFileNumber}`
              : 'Loan # —';

            return (
              <tr key={deal.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="flex flex-col">
                    {deal.referralId ? (
                      <Link
                        prefetch={false}
                        href={`/referrals/${deal.referralId}`}
                        className="font-medium text-brand transition hover:text-brand-dark hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900">{label}</span>
                    )}
                    <span className="text-xs text-slate-500">{detail}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{getStatusLabel(deal.status)}</td>
                <td className={`px-4 py-3 text-sm font-medium ${outcomeColor}`}>{outcome}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(expectedCents)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{formatCurrency(receivedCents)}</td>
                {showAgentColumn && (
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {deal.agent?.id ? (
                      <Link
                        prefetch={false}
                        href={`/agents/${deal.agent.id}`}
                        className="text-brand transition hover:text-brand-dark hover:underline"
                      >
                        {deal.agent.name || 'Agent'}
                      </Link>
                    ) : (
                      <span className="text-slate-500">Unassigned</span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
