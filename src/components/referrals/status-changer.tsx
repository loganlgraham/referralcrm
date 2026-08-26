'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import {
  getLostReasonOptions,
  getReferralStatusLabel,
  normalizeReferralStatus,
  type LostReason
} from '@/constants/referrals';
import { ReferralStatus } from '@/models/referral';
import { toast } from 'sonner';
import { TERMINATED_REASON_OPTIONS, type TerminatedReason } from '@/constants/deals';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { inputFieldClasses } from '@/components/ui/input';
import { selectFieldClasses } from '@/components/ui/field-group';

interface Props {
  referralId: string;
  status: ReferralStatus;
  statuses: readonly ReferralStatus[];
  includeTerminalStatuses?: boolean;
  /** Agent-created (agent→AFC) referrals use a narrower lost-reason list. */
  isAgentOrigin?: boolean;
  side?: 'buy' | 'sell';
  statusLabel?: string;
  showStatusControl?: boolean;
  showPreApproval?: boolean;
  preApprovalAmountCents?: number;
  onStatusChanged?: (status: ReferralStatus, payload?: Record<string, unknown>) => void;
  onPreApprovalSaved?: (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => void;
  onUnderContractIntentChange?: (isPreparing: boolean) => void;
}

const centsToCurrencyInput = (value?: number | null) => {
  if (!value) {
    return '';
  }
  const amount = value / 100;
  return Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
};

const sanitizeCurrencyInput = (value: string) => {
  if (!value) {
    return '';
  }
  const stripped = value.replace(/[^0-9.]/g, '');
  if (!stripped) {
    return '';
  }

  const [integerPart = '', ...decimalParts] = stripped.split('.');
  const decimalPart = decimalParts.join('').slice(0, 2);
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
  const hasDecimal = decimalParts.length > 0;
  const safeInteger = normalizedInteger || (integerPart.length > 0 ? '0' : '');

  if (!hasDecimal) {
    return safeInteger;
  }

  const integerPortion = safeInteger || '0';
  return decimalPart.length > 0 ? `${integerPortion}.${decimalPart}` : `${integerPortion}.`;
};

const formatCurrencyInputDisplay = (value: string) => {
  if (!value) {
    return '';
  }

  const [integerPart = '', decimalPart] = value.split('.');
  const hasDecimal = decimalPart !== undefined;
  const sanitizedInteger = integerPart.replace(/[^0-9]/g, '');
  const integerValue = sanitizedInteger ? Number(sanitizedInteger) : 0;
  const formattedInteger = sanitizedInteger
    ? integerValue.toLocaleString('en-US')
    : hasDecimal
    ? '0'
    : '';

  if (!hasDecimal) {
    return formattedInteger;
  }

  if (decimalPart === undefined) {
    return formattedInteger;
  }

  if (decimalPart.length === 0) {
    return `${formattedInteger}.`;
  }

  return `${formattedInteger}.${decimalPart}`;
};

export function StatusChanger({
  referralId,
  status,
  statuses,
  includeTerminalStatuses = false,
  isAgentOrigin = false,
  side,
  statusLabel = 'Pipeline Status',
  showStatusControl = true,
  showPreApproval = true,
  preApprovalAmountCents,
  onStatusChanged,
  onPreApprovalSaved,
  onUnderContractIntentChange,
}: Props) {
  const router = useRouter();
  const normalizedStatus = useMemo(() => normalizeReferralStatus(status) ?? status, [status]);
  const [currentStatus, setCurrentStatus] = useState<ReferralStatus>(normalizedStatus);
  const [persistedStatus, setPersistedStatus] = useState<ReferralStatus>(normalizedStatus);
  const [loading, setLoading] = useState(false);
  const [preApproval, setPreApproval] = useState(() => centsToCurrencyInput(preApprovalAmountCents));
  const [preApprovalDirty, setPreApprovalDirty] = useState(false);
  const [preApprovalSaving, setPreApprovalSaving] = useState(false);
  const [editingPreApproval, setEditingPreApproval] = useState(false);
  const [pendingTerminatedSelection, setPendingTerminatedSelection] = useState(false);
  const [terminatedReason, setTerminatedReason] = useState<TerminatedReason | ''>('');
  const [pendingLostSelection, setPendingLostSelection] = useState(false);
  const [lostReason, setLostReason] = useState<LostReason | ''>('');

  useEffect(() => {
    setCurrentStatus(normalizedStatus);
    setPersistedStatus(normalizedStatus);
  }, [normalizedStatus]);

  useEffect(() => {
    onUnderContractIntentChange?.(currentStatus === 'Under Contract');
  }, [currentStatus, onUnderContractIntentChange]);

  useEffect(() => {
    setPreApproval(centsToCurrencyInput(preApprovalAmountCents));
    setPreApprovalDirty(false);
  }, [preApprovalAmountCents]);

  const pipelineOptions = useMemo(() => {
    const filtered = includeTerminalStatuses
      ? [...statuses]
      : statuses.filter((item) => item !== 'Closed' && item !== 'Terminated');
    const containsCurrent = filtered.some((item) => item === currentStatus);
    if (!containsCurrent) {
      return [...filtered, currentStatus];
    }
    return filtered;
  }, [includeTerminalStatuses, statuses, currentStatus]);

  const lostReasonOptions = useMemo(() => getLostReasonOptions({ isAgentOrigin }), [isAgentOrigin]);

  const submitStatus = async (
    nextStatus: ReferralStatus,
    previousStatus: ReferralStatus,
    terminatedReason?: TerminatedReason | null,
    lostReason?: LostReason | null
  ) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          source: 'referral_detail',
          side,
          terminatedReason: nextStatus === 'Terminated' ? terminatedReason ?? null : null,
          lostReason: nextStatus === 'Lost' ? lostReason ?? null : null,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      const body = (await res.json()) as Record<string, unknown>;
      const resolvedStatus = (body.status as ReferralStatus | undefined) ?? nextStatus;
      setCurrentStatus(resolvedStatus);
      setPersistedStatus(resolvedStatus);
      if (resolvedStatus !== 'Terminated') {
        setTerminatedReason('');
      }
      if (resolvedStatus !== 'Lost') {
        setLostReason('');
      }
      setPendingTerminatedSelection(false);
      setPendingLostSelection(false);
      router.refresh();

      onStatusChanged?.(resolvedStatus, { ...body, previousStatus });
      toast.success('Referral status updated');
    } catch (error) {
      console.error(error);
      setCurrentStatus(previousStatus);
      toast.error(error instanceof Error ? error.message : 'Unable to update status');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextStatus = event.target.value as ReferralStatus;
    if (nextStatus === 'Terminated') {
      setCurrentStatus(nextStatus);
      setPendingTerminatedSelection(true);
      return;
    }

    if (nextStatus === 'Lost') {
      setCurrentStatus(nextStatus);
      setPendingLostSelection(true);
      return;
    }

    setCurrentStatus(nextStatus);
    onUnderContractIntentChange?.(nextStatus === 'Under Contract');
    void submitStatus(nextStatus, persistedStatus, null, null);
  };

  const handlePreApprovalChange = (event: ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeCurrencyInput(event.target.value);
    setPreApproval(sanitized);
    setPreApprovalDirty(true);
  };

  const handlePreApprovalSave = async () => {
    const amount = Number.parseFloat(preApproval);
    if (Number.isNaN(amount) || amount < 0) {
      toast.error('Enter a valid pre-approval amount.');
      return;
    }
    setPreApprovalSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/pre-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      if (!response.ok) {
        throw new Error('Unable to save pre-approval amount');
      }
      const body = (await response.json()) as { preApprovalAmountCents: number; referralFeeDueCents: number };
      toast.success('Pre-approval updated');
      setPreApprovalDirty(false);
      setEditingPreApproval(false);
      onPreApprovalSaved?.({
        preApprovalAmountCents: body.preApprovalAmountCents,
        referralFeeDueCents: body.referralFeeDueCents,
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update pre-approval');
    } finally {
      setPreApprovalSaving(false);
    }
  };

  const formattedPreApprovalDisplay = preApproval
    ? `$${formatCurrencyInputDisplay(preApproval)}`
    : 'No pre-approval';

  const handlePreApprovalCancel = () => {
    setPreApproval(centsToCurrencyInput(preApprovalAmountCents));
    setPreApprovalDirty(false);
    setEditingPreApproval(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {showStatusControl && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground-subtle">{statusLabel}</p>
            <select
              value={currentStatus}
              onChange={handleChange}
              className={selectFieldClasses}
              disabled={loading}
            >
              {pipelineOptions.map((item) => (
                <option key={item} value={item}>
                  {getReferralStatusLabel(item, { isAgentOrigin })}
                </option>
              ))}
            </select>
            {pendingTerminatedSelection && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-3">
                <label className="block text-xs font-medium text-foreground-muted">
                  Termination reason
                  <select
                    value={terminatedReason}
                    onChange={(event) => setTerminatedReason(event.target.value as TerminatedReason | '')}
                    className={cn(selectFieldClasses, 'mt-1')}
                    disabled={loading}
                  >
                    <option value="">Select reason</option>
                    {TERMINATED_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      if (!terminatedReason) {
                        toast.error('Termination reason is required.');
                        return;
                      }
                      setPendingTerminatedSelection(false);
                      void submitStatus('Terminated', persistedStatus, terminatedReason);
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      setPendingTerminatedSelection(false);
                      setTerminatedReason('');
                      setCurrentStatus(persistedStatus);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {pendingLostSelection && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-3">
                <label className="block text-xs font-medium text-foreground-muted">
                  Why was this lost?
                  <select
                    value={lostReason}
                    onChange={(event) => setLostReason(event.target.value as LostReason | '')}
                    className={cn(selectFieldClasses, 'mt-1')}
                    disabled={loading}
                  >
                    <option value="">Select reason</option>
                    {lostReasonOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!isAgentOrigin && (
                  <p className="text-xs text-foreground-subtle">
                    Losses that happened before the agent could reach the borrower are not counted
                    against the agent.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      if (!lostReason) {
                        toast.error('Please choose why this referral was lost.');
                        return;
                      }
                      setPendingLostSelection(false);
                      void submitStatus('Lost', persistedStatus, null, lostReason);
                    }}
                  >
                    Confirm
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      setPendingLostSelection(false);
                      setLostReason('');
                      setCurrentStatus(persistedStatus);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {showPreApproval && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-foreground-subtle">Pre-approval</div>
            {editingPreApproval ? (
              <div className="space-y-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={formatCurrencyInputDisplay(preApproval)}
                  onChange={handlePreApprovalChange}
                  className={cn(inputFieldClasses, 'tabular-nums')}
                  placeholder="300,000"
                  disabled={preApprovalSaving || loading}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={handlePreApprovalSave}
                    disabled={!preApprovalDirty}
                    loading={preApprovalSaving}
                    className="flex-1"
                  >
                    {preApprovalSaving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handlePreApprovalCancel}
                    disabled={preApprovalSaving || loading}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)]">
                <span className="tabular-nums">{formattedPreApprovalDisplay}</span>
                <button
                  type="button"
                  onClick={() => setEditingPreApproval(true)}
                  className="inline-flex items-center justify-center rounded-md p-1 text-foreground-subtle transition hover:bg-surface-muted hover:text-foreground-muted"
                  aria-label="Edit pre-approval"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
