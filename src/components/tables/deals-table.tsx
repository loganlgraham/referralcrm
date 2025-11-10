'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { toast } from 'sonner';

import { DEFAULT_AGENT_COMMISSION_BPS } from '@/constants/referrals';
import { fetcher } from '@/utils/fetcher';
import { formatCurrency } from '@/utils/formatters';

type DealStatus = 'under_contract' | 'closed' | 'paid' | 'terminated';
type TerminatedReason = 'inspection' | 'appraisal' | 'financing' | 'changed_mind';
type AgentSelectValue = '' | 'AHA' | 'AHA_OOS';

const STATUS_OPTIONS: { value: DealStatus; label: string }[] = [
  { value: 'under_contract', label: 'Under Contract' },
  { value: 'closed', label: 'Closed' },
  { value: 'paid', label: 'Paid' },
  { value: 'terminated', label: 'Terminated' }
];

const TERMINATED_REASON_OPTIONS: { value: TerminatedReason; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'appraisal', label: 'Appraisal' },
  { value: 'financing', label: 'Financing' },
  { value: 'changed_mind', label: 'Changed Mind' },
];

interface DealRow {
  _id: string;
  referralId: string;
  status: DealStatus;
  expectedAmountCents: number;
  receivedAmountCents: number;
  terminatedReason?: TerminatedReason | null;
  invoiceDate?: string | null;
  paidDate?: string | null;
  agentAttribution?: AgentSelectValue | null;
  usedAfc?: boolean | null;
  referral?: {
    borrowerName?: string | null;
    propertyAddress?: string | null;
    propertyZip?: string | null;
    commissionBasisPoints?: number | null;
    referralFeeBasisPoints?: number | null;
    estPurchasePriceCents?: number | null;
    preApprovalAmountCents?: number | null;
    referralFeeDueCents?: number | null;
    ahaBucket?: AgentSelectValue | null;
  } | null;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-4 py-3">
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function DealsTable() {
  const { data: session } = useSession();
  const { data, mutate } = useSWR<DealRow[]>('/api/payments', fetcher);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, TerminatedReason>>({});

  if (!data) {
    return <div className="rounded-lg bg-white p-4 shadow-sm">Loading deals…</div>;
  }

  const role = session?.user?.role;
  const isAgentView = role === 'agent';
  const isMcView = role === 'mc';
  const isAdminView = role === 'admin' || role === 'manager';

  const calculateCommission = (row: DealRow) => {
    if (row.status === 'terminated') {
      return 0;
    }

    const commissionBps = row.referral?.commissionBasisPoints ?? DEFAULT_AGENT_COMMISSION_BPS;
    const baseAmountCents =
      row.referral?.estPurchasePriceCents && row.referral.estPurchasePriceCents > 0
        ? row.referral.estPurchasePriceCents
        : row.referral?.preApprovalAmountCents ?? 0;

    if (!baseAmountCents || !commissionBps) {
      return 0;
    }

    return Math.round((baseAmountCents * commissionBps) / 10000);
  };

  const aggregates = data.reduce(
    (acc, row) => {
      const isTerminated = row.status === 'terminated';

      if (row.status === 'under_contract') {
        acc.totalUnderContract += 1;
      }
      if (isTerminated) {
        acc.totalTerminated += 1;
      }

      const expectedBase = row.expectedAmountCents ?? row.referral?.referralFeeDueCents ?? 0;
      const expected = isTerminated ? 0 : expectedBase;
      const paidAmount =
        row.status === 'paid'
          ? row.receivedAmountCents || row.expectedAmountCents || 0
          : 0;
      const effectivePaid = isTerminated ? 0 : paidAmount;
      const commission = calculateCommission(row);

      acc.expectedRevenue += expected;
      acc.receivedRevenue += effectivePaid;
      acc.referralFeesPaid += effectivePaid;
      acc.commissionEarned += commission;

      return acc;
    },
    {
      expectedRevenue: 0,
      receivedRevenue: 0,
      referralFeesPaid: 0,
      commissionEarned: 0,
      totalUnderContract: 0,
      totalTerminated: 0,
    }
  );

  const totalCommission = aggregates.commissionEarned - aggregates.referralFeesPaid;

  const summarySection = (() => {
    if (isAdminView) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Expected Revenue" value={formatCurrency(aggregates.expectedRevenue)} />
          <SummaryCard label="Received Revenue" value={formatCurrency(aggregates.receivedRevenue)} />
        </div>
      );
    }

    if (isMcView) {
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <SummaryCard label="Total Deals Under Contract" value={aggregates.totalUnderContract.toLocaleString()} />
          <SummaryCard label="Total Deals Terminated" value={aggregates.totalTerminated.toLocaleString()} />
        </div>
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Referral Fees Paid" value={formatCurrency(aggregates.referralFeesPaid)} />
        <SummaryCard label="Commission Earned" value={formatCurrency(aggregates.commissionEarned)} />
        <SummaryCard label="Total Commission" value={formatCurrency(totalCommission)} />
      </div>
    );
  })();

  const updateDeal = async (
    deal: DealRow,
    updates: Partial<
      Pick<
        DealRow,
        'status' | 'expectedAmountCents' | 'receivedAmountCents' | 'terminatedReason' | 'agentAttribution' | 'usedAfc'
      >
    >,
    successMessage: string
  ) => {
    const previousSnapshot = data;
    const optimisticRow: DealRow = { ...deal, ...updates };
    const optimistic = data.map((row) => (row._id === deal._id ? optimisticRow : row));

    setUpdatingId(deal._id);
    await mutate(optimistic, false);

    try {
      const payload: Record<string, unknown> = { id: deal._id };
      if ('status' in updates && updates.status) {
        payload.status = updates.status;
      }
      if ('expectedAmountCents' in updates) {
        payload.expectedAmountCents = updates.expectedAmountCents ?? 0;
      }
      if ('receivedAmountCents' in updates) {
        payload.receivedAmountCents = updates.receivedAmountCents ?? 0;
      }
      if ('terminatedReason' in updates) {
        payload.terminatedReason = updates.terminatedReason ?? null;
      }
      if ('agentAttribution' in updates) {
        payload.agentAttribution = updates.agentAttribution ?? null;
      }
      if ('usedAfc' in updates) {
        payload.usedAfc = updates.usedAfc ?? false;
      }

      const response = await fetch('/api/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Unable to update deal');
      }

      toast.success(successMessage);
      await mutate();
    } catch (error) {
      console.error(error);
      await mutate(previousSnapshot, false);
      toast.error(error instanceof Error ? error.message : 'Unable to update deal');
      await mutate();
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAgentOutcomeChange = async (deal: DealRow, nextValue: AgentSelectValue) => {
    if ((deal.agentAttribution ?? '') === nextValue) {
      return;
    }

    await updateDeal(
      deal,
      { agentAttribution: nextValue || null },
      'Agent outcome updated'
    );
  };

  const handleAfcUsageChange = async (deal: DealRow, checked: boolean) => {
    if (Boolean(deal.usedAfc) === checked) {
      return;
    }

    await updateDeal(deal, { usedAfc: checked }, 'AFC usage updated');
  };

  const handleStatusChange = async (deal: DealRow, nextStatus: DealStatus) => {
    const updates: Partial<
      Pick<DealRow, 'status' | 'expectedAmountCents' | 'receivedAmountCents' | 'terminatedReason'>
    > = {
      status: nextStatus,
    };

    if (nextStatus === 'terminated') {
      updates.expectedAmountCents = 0;
      updates.receivedAmountCents = 0;
      const fallbackReason =
        reasonDrafts[deal._id] ?? deal.terminatedReason ?? 'inspection';
      updates.terminatedReason = fallbackReason;
      setReasonDrafts((prev) => ({ ...prev, [deal._id]: fallbackReason }));
    } else {
      const fallbackExpected = deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
      if (fallbackExpected > 0) {
        updates.expectedAmountCents = fallbackExpected;
      }
      updates.terminatedReason = null;
      setReasonDrafts((prev) => {
        if (!(deal._id in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
    }

    await updateDeal(deal, updates, 'Deal status updated');
  };

  const handleTerminatedReasonChange = async (deal: DealRow, nextReason: TerminatedReason) => {
    setReasonDrafts((prev) => ({ ...prev, [deal._id]: nextReason }));

    if (deal.status !== 'terminated' && deal.terminatedReason !== nextReason) {
      return;
    }

    if (deal.status === 'terminated' && deal.terminatedReason === nextReason) {
      return;
    }

    await updateDeal(deal, { terminatedReason: nextReason }, 'Termination reason updated');
  };

  const handlePaidToggle = async (deal: DealRow, checked: boolean) => {
    if (deal.status === 'terminated') {
      return;
    }

    if (checked && deal.status === 'paid') {
      return;
    }

    if (!checked && deal.status !== 'paid') {
      return;
    }

    const nextStatus: DealStatus = checked ? 'paid' : 'closed';
    const updates: Partial<Pick<DealRow, 'status' | 'expectedAmountCents'>> = {
      status: nextStatus,
    };

    const fallbackExpected = deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
    if (fallbackExpected > 0) {
      updates.expectedAmountCents = fallbackExpected;
    }

    await updateDeal(deal, updates, 'Deal status updated');
  };

  const handleAmountChange = (dealId: string, value: string) => {
    setAmountDrafts((prev) => ({ ...prev, [dealId]: value }));
  };

  const handleAmountBlur = async (deal: DealRow) => {
    const draft = amountDrafts[deal._id];
    if (draft === undefined) {
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed) {
      setAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
      return;
    }

    const parsed = Number(trimmed.replace(/[^0-9.]/g, ''));
    if (Number.isNaN(parsed) || parsed < 0) {
      toast.error('Enter a valid received amount');
      setAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
      return;
    }

    const cents = Math.round(parsed * 100);
    if (cents === (deal.receivedAmountCents ?? 0)) {
      setAmountDrafts((prev) => {
        const next = { ...prev };
        delete next[deal._id];
        return next;
      });
      return;
    }

    await updateDeal(deal, { receivedAmountCents: cents }, 'Received amount updated');
    setAmountDrafts((prev) => {
      const next = { ...prev };
      delete next[deal._id];
      return next;
    });
  };

  const renderReferralLink = (deal: DealRow) => {
    const label = deal.referral?.borrowerName || 'Referral';
    const href = deal.referralId ? `/referrals/${deal.referralId}` : '#';

    if (!deal.referralId) {
      return <span className="font-medium text-slate-900">{label}</span>;
    }

    return (
      <Link
        prefetch={false}
        href={href}
        className="font-medium text-brand transition hover:text-brand-dark hover:underline"
      >
        {label}
      </Link>
    );
  };

  const renderStatusControl = (deal: DealRow) => {
    const isTerminated = deal.status === 'terminated';
    const selectedReason =
      reasonDrafts[deal._id] ?? deal.terminatedReason ?? 'inspection';

    return (
      <div className="space-y-2">
        <select
          value={deal.status}
          onChange={(event) => handleStatusChange(deal, event.target.value as DealStatus)}
          className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
          disabled={updatingId === deal._id}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {isTerminated && (
          <select
            value={selectedReason}
            onChange={(event) =>
              handleTerminatedReasonChange(deal, event.target.value as TerminatedReason)
            }
            className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
            disabled={updatingId === deal._id}
          >
            {TERMINATED_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  const formatCentsForInput = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return '';
    }
    return (value / 100).toFixed(2);
  };

  const renderAdminTable = () => (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Agent Outcome</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Address</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral Fee</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Amount Received</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Paid</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Used AFC</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((deal) => {
            const isTerminated = deal.status === 'terminated';
            const referralFee = isTerminated
              ? 0
              : deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents ?? 0;
            const receivedDraft = amountDrafts[deal._id];
            const receivedInputValue =
              receivedDraft !== undefined ? receivedDraft : formatCentsForInput(deal.receivedAmountCents ?? 0);

            return (
              <tr key={deal._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="flex flex-col">
                    {renderReferralLink(deal)}
                    <span className="text-xs text-slate-500">{deal.referralId}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderStatusControl(deal)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  <select
                    value={deal.agentAttribution ?? ''}
                    onChange={(event) =>
                      handleAgentOutcomeChange(deal, event.target.value as AgentSelectValue)
                    }
                    className="w-full rounded border border-slate-200 px-2 py-1 text-sm text-slate-700"
                    disabled={updatingId === deal._id}
                  >
                    <option value="">Not set</option>
                    <option value="AHA">Used AHA</option>
                    <option value="AHA_OOS">Used AHA OOS</option>
                  </select>
                  {deal.referral?.ahaBucket && deal.agentAttribution &&
                    deal.agentAttribution !== deal.referral.ahaBucket && (
                      <p className="mt-1 text-xs text-amber-600">
                        Does not match assigned {deal.referral.ahaBucket === 'AHA' ? 'AHA' : 'AHA OOS'} bucket
                      </p>
                    )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {deal.referral?.propertyAddress || deal.referral?.propertyZip || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(referralFee)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={receivedInputValue}
                        onChange={(event) => handleAmountChange(deal._id, event.target.value)}
                        onBlur={() => handleAmountBlur(deal)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                          if (event.key === 'Escape') {
                            setAmountDrafts((prev) => {
                              const next = { ...prev };
                              delete next[deal._id];
                              return next;
                            });
                            event.currentTarget.blur();
                          }
                        }}
                        className="w-28 rounded border border-slate-200 px-2 py-1 text-sm text-slate-700 focus:border-brand focus:outline-none"
                        disabled={updatingId === deal._id}
                      />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                        checked={deal.status === 'paid'}
                        onChange={(event) => handlePaidToggle(deal, event.target.checked)}
                        disabled={updatingId === deal._id}
                      />
                      <span className="text-sm text-slate-700">{deal.status === 'paid' ? 'Yes' : 'No'}</span>
                    </label>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {isTerminated ? (
                    '—'
                  ) : (
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                        checked={Boolean(deal.usedAfc)}
                        onChange={(event) => handleAfcUsageChange(deal, event.target.checked)}
                        disabled={updatingId === deal._id}
                      />
                      <span className="text-sm text-slate-700">{Boolean(deal.usedAfc) ? 'Yes' : 'No'}</span>
                    </label>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderDefaultTable = () => (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Referral Fee</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              {isAgentView ? 'Referral Fee Paid' : 'Paid'}
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Commission</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Net Commission</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((deal) => {
            const commission = calculateCommission(deal);
            const isTerminated = deal.status === 'terminated';
            const paidAmount = isTerminated
              ? 0
              : deal.status === 'paid'
                ? deal.receivedAmountCents || deal.expectedAmountCents || 0
                : deal.receivedAmountCents || 0;
            const referralFee = isTerminated
              ? 0
              : deal.referral?.referralFeeDueCents ?? deal.expectedAmountCents;
            const netCommission = isTerminated ? 0 : commission - paidAmount;

            return (
              <tr key={deal._id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-700">
                  <div className="flex flex-col">
                    {renderReferralLink(deal)}
                    <span className="text-xs text-slate-500">
                      {deal.referral?.propertyAddress || deal.referral?.propertyZip || deal.referralId}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{renderStatusControl(deal)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(referralFee || 0)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(paidAmount)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(commission)}</td>
                <td className="px-4 py-3 text-sm text-slate-700">{isTerminated ? '—' : formatCurrency(netCommission)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      {summarySection}
      {isAdminView ? renderAdminTable() : renderDefaultTable()}
    </div>
  );
}
