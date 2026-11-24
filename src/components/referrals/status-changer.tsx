'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getLostReasonOptions,
  getReferralStatusLabel,
  LOST_BEFORE_CONTACT_HINT,
  normalizeReferralStatus,
  type LostReason
} from '@/constants/referrals';
import { ReferralStatus } from '@/models/referral';
import { toast } from 'sonner';
import { type TerminatedReason } from '@/constants/deals';
import { cn } from '@/lib/cn';
import { Button, buttonClasses } from '@/components/ui/button';
import { selectFieldClasses } from '@/components/ui/field-group';
import { confirmLostReason } from '@/components/referrals/lost-reason-confirmation-toast';
import { confirmReferralTermination } from '@/components/referrals/terminate-confirmation-toast';
import { StageTrack, isOutcomeStatus } from '@/components/referrals/stage-track';
import { PreApprovalField } from '@/components/referrals/pre-approval-field';
import {
  collectUnderContractDeal,
  submitUnderContractDeal
} from '@/components/referrals/deal-details-toast';
import {
  confirmPairedFubSend,
  fubSendOutcomeMessage,
  type FubSendUiStatus,
} from '@/components/referrals/paired-fub-confirmation-toast';
import type { PairedHandoff } from '@/lib/fub/paired-handoff';
import type { MockFubApprovalPreview } from '@/lib/server/mock-fub-send';

interface Props {
  referralId: string;
  status: ReferralStatus;
  statuses: readonly ReferralStatus[];
  includeTerminalStatuses?: boolean;
  /** Agent-created (agent→AFC) referrals use a narrower lost-reason list. */
  isAgentOrigin?: boolean;
  side?: 'buy' | 'sell';
  statusLabel?: string;
  /**
   * `chips` renders the pipeline as a single row of tappable pills instead of a `<select>`;
   * `track` renders it as a segmented progress bar with Lost/Terminated in a close-out menu.
   */
  mode?: 'select' | 'chips' | 'track';
  /** Shown under the current step in `track` mode. */
  daysInStatus?: number | null;
  /** Thinner `track` with no per-step labels, for stacking buy and sell tracks. */
  compactTrack?: boolean;
  /** `toast` collects reasons in an overlay card instead of an inline panel under the control. */
  promptMode?: 'inline' | 'toast';
  /** Names the client in the toast prompts. */
  borrowerName?: string;
  /** `row` places the status control and pre-approval side by side on wider screens. */
  layout?: 'stack' | 'row';
  showStatusControl?: boolean;
  showPreApproval?: boolean;
  preApprovalAmountCents?: number;
  /**
   * When set, the control follows `sideStatus` from the API so a two-sided
   * referral keeps showing this viewer's side instead of the combined status.
   */
  preferSideStatus?: boolean;
  onStatusChanged?: (status: ReferralStatus, payload?: Record<string, unknown>) => void;
  onPreApprovalSaved?: (details: { preApprovalAmountCents: number; referralFeeDueCents: number }) => void;
  onUnderContractIntentChange?: (isPreparing: boolean) => void;
  pairedFubEnabled?: boolean;
  fixtureFubApproval?: boolean;
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

export function StatusChanger({
  referralId,
  status,
  statuses,
  includeTerminalStatuses = false,
  isAgentOrigin = false,
  side,
  statusLabel = 'Pipeline Status',
  mode = 'select',
  daysInStatus,
  compactTrack = false,
  promptMode = 'inline',
  borrowerName = 'this referral',
  layout = 'stack',
  showStatusControl = true,
  showPreApproval = true,
  preApprovalAmountCents,
  preferSideStatus = false,
  onStatusChanged,
  onPreApprovalSaved,
  onUnderContractIntentChange,
  pairedFubEnabled = false,
  fixtureFubApproval = false,
}: Props) {
  const router = useRouter();
  const normalizedStatus = useMemo(() => normalizeReferralStatus(status) ?? status, [status]);
  const [currentStatus, setCurrentStatus] = useState<ReferralStatus>(normalizedStatus);
  const [persistedStatus, setPersistedStatus] = useState<ReferralStatus>(normalizedStatus);
  const [loading, setLoading] = useState(false);
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
    extra: StatusSubmitExtras = {},
    showSuccessToast = true,
  ): Promise<boolean> => {
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
      const reportedStatus = preferSideStatus ? body.sideStatus : body.status;
      const resolvedStatus = (reportedStatus as ReferralStatus | undefined) ?? (body.status as ReferralStatus | undefined) ?? nextStatus;
      setCurrentStatus(resolvedStatus);
      setPersistedStatus(resolvedStatus);
      if (resolvedStatus !== 'Lost') {
        setLostReason('');
      }
      setPendingLostSelection(false);
      router.refresh();

      onStatusChanged?.(resolvedStatus, { ...body, previousStatus });
      const handoff = body.pairedHandoff as PairedHandoff | undefined;
      if (handoff) {
        if (handoff.sent) toast.success(handoff.message);
        else toast.warning(handoff.message);
      } else if (showSuccessToast) {
        toast.success('Referral status updated');
      }
      return true;
    } catch (error) {
      console.error(error);
      setCurrentStatus(previousStatus);
      toast.error(error instanceof Error ? error.message : 'Unable to update status');
      return false;
    } finally {
      setLoading(false);
    }
  };

  function showMockFubOutcome(
    status: FubSendUiStatus,
    recovered: boolean,
    toastId: string | number,
    approvalKey: string,
  ): void {
    const outcome = fubSendOutcomeMessage(status, recovered);
    if (outcome.kind === 'success') {
      toast.success(outcome.message, { id: toastId });
    } else if (outcome.kind === 'info') {
      toast.info(outcome.message, {
        id: toastId,
        action:
          status === 'running' || status === 'pending'
            ? {
                label: 'Check status',
                onClick: () => {
                  void recoverMockFubOutcome(
                    approvalKey,
                    toast.loading('Checking FUB status…'),
                    'The FUB status is still unavailable.',
                  );
                },
              }
            : undefined,
      });
    } else {
      toast.error(outcome.message, {
        id: toastId,
        action:
          status === 'partial_failure'
            ? {
                label: 'Retry safe steps',
                onClick: () => {
                  void submitMockFubApproval(approvalKey, true);
                },
              }
            : undefined,
      });
    }
  }

  async function recoverMockFubOutcome(
    approvalKey: string,
    toastId: string | number,
    fallbackMessage: string,
  ): Promise<void> {
    const previewResponse = await fetch(
      `/api/referrals/${referralId}/fub-send`,
      { cache: 'no-store' },
    ).catch(() => null);
    const preview = previewResponse?.ok
      ? ((await previewResponse.json().catch(() => null)) as MockFubApprovalPreview | null)
      : null;
    if (preview?.attemptStatus) {
      showMockFubOutcome(
        preview.attemptStatus,
        false,
        toastId,
        approvalKey,
      );
      return;
    }
    toast.error(`Paired saved. ${fallbackMessage}`, { id: toastId });
  }

  async function submitMockFubApproval(
    approvalKey: string,
    isRetry = false,
  ): Promise<void> {
    const toastId = toast.loading(
      isRetry ? 'Retrying safe FUB steps…' : 'Sending approved FUB steps…',
    );
    try {
      const response = await fetch(`/api/referrals/${referralId}/fub-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalKey }),
      });
      const body = (await response.json().catch(() => null)) as {
        status?: FubSendUiStatus;
        recovered?: boolean;
        steps?: Array<{ status: string; errorMessage?: string }>;
        error?: string;
      } | null;
      if (!response.ok || !body?.status) {
        await recoverMockFubOutcome(
          approvalKey,
          toastId,
          body?.error ?? 'The FUB send could not start.',
        );
        return;
      }
      const failedStep = body.steps?.find(step => step.status === 'failed' || step.status === 'ambiguous');
      if (failedStep?.errorMessage) toast.error(failedStep.errorMessage);
      showMockFubOutcome(
        body.status,
        Boolean(body.recovered),
        toastId,
        approvalKey,
      );
    } catch (error) {
      await recoverMockFubOutcome(
        approvalKey,
        toastId,
        error instanceof Error ? error.message : 'The FUB send could not start.',
      );
    }
  }

  /** Statuses needing more information collect it first instead of writing straight through. */
  const selectStatus = async (nextStatus: ReferralStatus) => {
    if (nextStatus === 'Paired' && pairedFubEnabled && (persistedStatus === 'Paired' || fixtureFubApproval)) {
      setPrompting(true);
      try {
        const response = await fetch(`/api/referrals/${referralId}/fub-send`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not check the Follow Up Boss handoff.');
        const preview = await response.json() as MockFubApprovalPreview;
        if (preview.attemptStatus === 'success') toast.success('This referral was already sent to Follow Up Boss.');
        else if (fixtureFubApproval && persistedStatus !== 'Paired') {
          const choice = await confirmPairedFubSend(preview);
          if (choice === 'cancel' || !await submitStatus('Paired', persistedStatus)) return;
          if (choice === 'send') await submitMockFubApproval(preview.approvalKey);
        } else await submitMockFubApproval(preview.approvalKey);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Follow Up Boss is unavailable.');
      } finally {
        setPrompting(false);
      }
      return;
    }

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

  const bothVisible = showStatusControl && showPreApproval;
  return (
    <div className="space-y-4">
      {pairedFubEnabled && persistedStatus === 'Paired' && (
        <button type="button" disabled={loading || prompting} className="text-sm font-semibold underline" onClick={() => void selectStatus('Paired')}>Send to Follow Up Boss</button>
      )}
      <div className={layout === 'row' && bothVisible ? 'grid gap-4 sm:grid-cols-2' : 'space-y-4'}>
        {showStatusControl && (
          <div className="space-y-1">
            {mode === 'track' ? (
              <StageTrack
                options={pipelineOptions}
                currentStatus={currentStatus}
                getLabel={(status) => getReferralStatusLabel(status, { isAgentOrigin })}
                isOutcome={isOutcomeStatus}
                daysInStatus={daysInStatus}
                disabled={loading || prompting || pendingLostSelection}
                compact={compactTrack}
                ariaLabel={statusLabel}
                onSelect={(next) => void selectStatus(next)}
              />
            ) : mode === 'chips' ? (
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
                        buttonClasses({ variant: 'secondary', size: 'md' }),
                        isCurrent
                          ? 'bg-warning-soft px-3.5 font-bold text-warning shadow-[inset_0_0_0_1px_hsl(var(--warning)/0.35)] ring-0 hover:bg-warning-soft'
                          : item === 'Lost' || item === 'Terminated'
                            ? 'text-foreground-subtle'
                            : 'text-foreground-muted'
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
                    {LOST_BEFORE_CONTACT_HINT}
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
          <PreApprovalField
            referralId={referralId}
            amountCents={preApprovalAmountCents}
            onSaved={onPreApprovalSaved}
            disabled={loading}
          />
        )}
      </div>
    </div>
  );
}
