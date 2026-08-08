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

const resolveExpectedCents = (deal: PersonDealSummary): number => {
  if (deal.status === 'terminated') {
    return 0;
  }
  return deal.expectedAmountCents ?? 0;
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
    return 'text-foreground';
  }
  if (outcome === 'Lost') {
    return 'text-danger';
  }
  return 'text-foreground-subtle';
};

export function PersonDealsTable({ deals, context }: PersonDealsTableProps) {
  if (!Array.isArray(deals) || deals.length === 0) {
    return <p className="text-sm text-foreground-subtle">No deals recorded yet.</p>;
  }

  const showAgentColumn = context === 'mc' && deals.some((deal) => deal.agent?.id);

  return (
    <>
      <div className="space-y-3 md:hidden">
        {deals.map((deal) => {
          const outcome = computeOutcome(deal, context);
          const outcomeColor = outcomeClassName(outcome);
          const expectedCents = resolveExpectedCents(deal);
          const receivedCents = deal.receivedAmountCents ?? 0;
          const label = deal.borrowerName?.trim() || 'Referral';
          const detail = deal.propertyAddress?.trim()
            ? deal.propertyAddress
            : deal.loanFileNumber
              ? `Loan # ${deal.loanFileNumber}`
              : 'Loan # —';

          return (
            <div
              key={deal.id}
              className="space-y-3 rounded-card border border-border bg-surface-raised p-4 shadow-card"
            >
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Referral</p>
                <div className="text-sm text-foreground-muted">
                  <div className="flex flex-col gap-0.5 break-words">
                    {deal.referralId ? (
                      <Link
                        prefetch={false}
                        href={`/referrals/${deal.referralId}`}
                        className="font-medium text-primary transition hover:text-primary-hover hover:underline"
                      >
                        {label}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{label}</span>
                    )}
                    <span className="text-xs text-foreground-subtle">{detail}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Status</p>
                <p className="text-sm text-foreground-muted">{getStatusLabel(deal.status)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Outcome</p>
                <p className={`text-sm font-medium ${outcomeColor}`}>{outcome}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Expected</p>
                <p className="text-sm text-foreground-muted">{formatCurrency(expectedCents)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Received</p>
                <p className="text-sm text-foreground-muted">{formatCurrency(receivedCents)}</p>
              </div>
              {showAgentColumn ? (
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Agent</p>
                  <div className="text-sm text-foreground-muted">
                    {deal.agent?.id ? (
                      <Link
                        prefetch={false}
                        href={`/agents/${deal.agent.id}`}
                        className="text-primary transition hover:text-primary-hover hover:underline break-words"
                      >
                        {deal.agent.name || 'Agent'}
                      </Link>
                    ) : (
                      <span className="text-foreground-subtle">Unassigned</span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="hidden overflow-hidden rounded-card border border-border bg-surface-raised shadow-card md:block">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Referral
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Outcome
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Expected
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Received
              </th>
              {showAgentColumn && (
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Agent
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {deals.map((deal) => {
              const outcome = computeOutcome(deal, context);
              const outcomeColor = outcomeClassName(outcome);
              const expectedCents = resolveExpectedCents(deal);
              const receivedCents = deal.receivedAmountCents ?? 0;
              const label = deal.borrowerName?.trim() || 'Referral';
              const detail = deal.propertyAddress?.trim()
                ? deal.propertyAddress
                : deal.loanFileNumber
                  ? `Loan # ${deal.loanFileNumber}`
                  : 'Loan # —';

              return (
                <tr key={deal.id} className="hover:bg-surface-muted">
                  <td className="px-4 py-3 text-sm text-foreground-muted">
                    <div className="flex flex-col">
                      {deal.referralId ? (
                        <Link
                          prefetch={false}
                          href={`/referrals/${deal.referralId}`}
                          className="font-medium text-primary transition hover:text-primary-hover hover:underline"
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">{label}</span>
                      )}
                      <span className="text-xs text-foreground-subtle">{detail}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{getStatusLabel(deal.status)}</td>
                  <td className={`px-4 py-3 text-sm font-medium ${outcomeColor}`}>{outcome}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{formatCurrency(expectedCents)}</td>
                  <td className="px-4 py-3 text-sm text-foreground-muted">{formatCurrency(receivedCents)}</td>
                  {showAgentColumn && (
                    <td className="px-4 py-3 text-sm text-foreground-muted">
                      {deal.agent?.id ? (
                        <Link
                          prefetch={false}
                          href={`/agents/${deal.agent.id}`}
                          className="text-primary transition hover:text-primary-hover hover:underline"
                        >
                          {deal.agent.name || 'Agent'}
                        </Link>
                      ) : (
                        <span className="text-foreground-subtle">Unassigned</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
