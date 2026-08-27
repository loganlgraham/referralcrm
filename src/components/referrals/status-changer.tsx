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
import { type TerminatedReason } from '@/constants/deals';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { inputFieldClasses } from '@/components/ui/input';
import { selectFieldClasses } from '@/components/ui/field-group';
import { confirmLostReason } from '@/components/referrals/lost-reason-confirmation-toast';
import { confirmReferralTermination } from '@/components/referrals/terminate-confirmation-toast';
import {
  collectUnderContractDeal,
  submitUnderContractDeal
} from '@/components/referrals/deal-details-toast';

interface Props {
  referralId: string;
  status: ReferralStatus;
  statuses: readonly ReferralStatus[];
  includeTerminalStatuses?: boolean;
  /** Agent-created (agent→AFC) referrals use a narrower lost-reason list. */
  isAgentOrigin?: boolean;
  side?: 'buy' | 'sell';
  statusLabel?: string;
  /** `chips` renders the pipeline as a single row of tappable pills instead of a `<select>`. */
  mode?: 'select' | 'chips';
  /** `toast` collects reasons in an overlay card instead of an inline panel under the control. */
  promptMode?: 'inline' | 'toast';
  /** Names the client in the toast prompts. */
  borrowerName?: string;
  showStatusControl?: boolean;
  showPreApproval?: boolean;
  preApprovalAmountCents?: number;
  onStatusChanged?: (status: ReferralStatus, payload?: Record<string, unknown>) => void;
  onPreApprovalSaved?: (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => void;
  onUnderContractIntentChange?: (isPreparing: boolean) => void;
}

/** Fields the prompts collect on top of the status itself. */
interface StatusSubmitExtras {
  terminatedReason?: TerminatedReason | null;
  lostReason?: LostReason | null;
  terminateDeal?: boolean;
  closingDate?: string;
  usedAfc?: boolean;
  sendClosedEmails?: boolean;
  sendAgentNpsEmail?: boolean;
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
  mode = 'select',
  promptMode = 'inline',
  borrowerName = 'this referral',
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
  const [pendingLostSelection, setPendingLostSelection] = useState(false);
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  /** Keeps the chips inert while a prompt toast is open so prompts cannot stack. */
  const [prompting, setPrompting] = useState(false);

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
    extra: StatusSubmitExtras = {}
  ) => {
    const { terminatedReason, lostReason, ...passthrough } = extra;
    setLoading(true);
    try {
      const res = await fetch(`/api/referrals/${referralId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: nextStatus,
          source: 'referral_detail',
          side,
          // A termination can resolve to Active Lead or Lost, so the reason is
          // sent whenever the prompt collected one rather than keyed off status.
          terminatedReason: terminatedReason ?? null,
          lostReason: nextStatus === 'Lost' ? lostReason ?? null : null,
          ...passthrough,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      const body = (await res.json()) as Record<string, unknown>;
      const resolvedStatus = (body.status as ReferralStatus | undefined) ?? nextStatus;
      setCurrentStatus(resolvedStatus);
      setPersistedStatus(resolvedStatus);
      if (resolvedStatus !== 'Lost') {
        setLostReason('');
      }
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

  /** Statuses needing more information collect it first instead of writing straight through. */
  const selectStatus = async (nextStatus: ReferralStatus) => {
    // Inline mode reveals the deal form under the control instead, so only the
    // toast surfaces collect the deal before moving the status.
    if (nextStatus === 'Under Contract' && promptMode === 'toast') {
      setPrompting(true);
      const saved = await collectUnderContractDeal({
        defaultSide: side === 'sell' ? 'sell' : 'buy',
        isAgentOrigin,
        onSubmit: (result) => submitUnderContractDeal(referralId, result, 'referral_detail'),
      });
      setPrompting(false);
      if (!saved) {
        return;
      }
      // `submitUnderContractDeal` already moved the status, so skip `submitStatus`.
      setCurrentStatus('Under Contract');
      setPersistedStatus('Under Contract');
      onUnderContractIntentChange?.(true);
      onStatusChanged?.('Under Contract', { previousStatus: persistedStatus });
      router.refresh();
      toast.success('Deal saved and referral moved to Under Contract');
      return;
    }

    if (nextStatus === 'Terminated') {
      setPrompting(true);
      const confirmation = await confirmReferralTermination({ borrowerName, isAgentOrigin });
      setPrompting(false);
      if (!confirmation.confirmed || !confirmation.resolvedStatus || !confirmation.terminatedReason) {
        return;
      }
      await submitStatus(confirmation.resolvedStatus, persistedStatus, {
        terminatedReason: confirmation.terminatedReason,
        lostReason: confirmation.lostReason,
        terminateDeal: true,
      });
      return;
    }

    if (nextStatus === 'Lost') {
      if (promptMode === 'inline') {
        setCurrentStatus(nextStatus);
        setPendingLostSelection(true);
        return;
      }

      setPrompting(true);
      const confirmation = await confirmLostReason({ borrowerName, isAgentOrigin });
      setPrompting(false);
      if (!confirmation.confirmed || !confirmation.lostReason) {
        return;
      }
      await submitStatus('Lost', persistedStatus, { lostReason: confirmation.lostReason });
      return;
    }

    setCurrentStatus(nextStatus);
    onUnderContractIntentChange?.(nextStatus === 'Under Contract');
    await submitStatus(nextStatus, persistedStatus);
  };

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    void selectStatus(event.target.value as ReferralStatus);
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
            {mode === 'chips' ? (
              <div className="flex flex-wrap gap-1.5">
                {pipelineOptions.map((item) => {
                  const isCurrent = item === currentStatus;
                  return (
                    <button
                      key={item}
                      type="button"
                      disabled={loading || prompting || isCurrent}
                      aria-current={isCurrent}
                      onClick={() => void selectStatus(item)}
                      className={cn(
                        'inline-flex h-9 items-center rounded-pill px-[13px] text-[13px] transition disabled:cursor-default',
                        isCurrent
                          ? 'bg-warning-soft px-3.5 font-bold text-warning shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.35)]'
                          : item === 'Lost' || item === 'Terminated'
                            ? 'border border-border bg-surface font-medium text-foreground-subtle hover:bg-surface-muted'
                            : 'border border-border bg-surface font-medium text-foreground-muted hover:bg-surface-muted'
                      )}
                    >
                      {getReferralStatusLabel(item, { isAgentOrigin })}
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <p className="text-xs font-medium text-foreground-subtle">{statusLabel}</p>
                <select
                  value={currentStatus}
                  onChange={handleChange}
                  className={selectFieldClasses}
                  disabled={loading || prompting}
                >
                  {pipelineOptions.map((item) => (
                    <option key={item} value={item}>
                      {getReferralStatusLabel(item, { isAgentOrigin })}
                    </option>
                  ))}
                </select>
              </>
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
                      void submitStatus('Lost', persistedStatus, { lostReason });
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
