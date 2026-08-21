import Link from 'next/link';

import { DEAL_STATUS_LABELS, type DealStatus } from '@/constants/deals';
import { formatCurrency } from '@/utils/formatters';
import { EmptyState } from '@/components/ui/empty-state';
import { TBody, THead, Table, TableScroll, TableShell, Td, Th, Tr } from '@/components/ui/table-shell';

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
    return <EmptyState compact title="No deals recorded yet" />;
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
                <p className="text-eyebrow text-foreground-subtle">Referral</p>
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
                <p className="text-eyebrow text-foreground-subtle">Status</p>
                <p className="text-sm text-foreground-muted">{getStatusLabel(deal.status)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-eyebrow text-foreground-subtle">Outcome</p>
                <p className={`text-sm font-medium ${outcomeColor}`}>{outcome}</p>
              </div>
              <div className="space-y-1">
                <p className="text-eyebrow text-foreground-subtle">Expected</p>
                <p className="text-numeric text-sm text-foreground-muted">{formatCurrency(expectedCents)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-eyebrow text-foreground-subtle">Received</p>
                <p className="text-numeric text-sm text-foreground-muted">{formatCurrency(receivedCents)}</p>
              </div>
              {showAgentColumn ? (
                <div className="space-y-1">
                  <p className="text-eyebrow text-foreground-subtle">Agent</p>
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
      <TableShell className="hidden md:block">
        <TableScroll>
          <Table className="min-w-full">
            <THead>
              <Tr>
                <Th className="text-eyebrow">Referral</Th>
                <Th className="text-eyebrow">Status</Th>
                <Th className="text-eyebrow">Outcome</Th>
                <Th className="text-eyebrow">Expected</Th>
                <Th className="text-eyebrow">Received</Th>
                {showAgentColumn && <Th className="text-eyebrow">Agent</Th>}
              </Tr>
            </THead>
            <TBody>
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
                <Tr key={deal.id}>
                  <Td className="text-foreground-muted">
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
                  </Td>
                  <Td className="text-foreground-muted">{getStatusLabel(deal.status)}</Td>
                  <Td className={`font-medium ${outcomeColor}`}>{outcome}</Td>
                  <Td className="text-numeric text-foreground-muted">{formatCurrency(expectedCents)}</Td>
                  <Td className="text-numeric text-foreground-muted">{formatCurrency(receivedCents)}</Td>
                  {showAgentColumn && (
                    <Td className="text-foreground-muted">
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
                    </Td>
                  )}
                </Tr>
              );
            })}
            </TBody>
          </Table>
        </TableScroll>
      </TableShell>
    </>
  );
}
