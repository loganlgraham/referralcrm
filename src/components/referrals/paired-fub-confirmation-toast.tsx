'use client';

import { Badge } from '@/components/ui/badge';
import {
  openPromptToast,
  promptToastWarningClasses,
  PromptToastCard,
} from '@/components/referrals/prompt-toast-shell';
import type { MockFubApprovalPreview } from '@/lib/server/mock-fub-send';

export type PairedFubChoice = 'send' | 'paired_only' | 'cancel';
export type FubSendUiStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial_failure'
  | 'ambiguous';

export function PairedFubConfirmationCard({
  preview,
  onChoose,
}: {
  preview: MockFubApprovalPreview;
  onChoose: (choice: PairedFubChoice) => void;
}) {
  const canSend = preview.mappingState === 'ready';
  const mappingMessage =
    preview.mappingState === 'missing'
      ? 'This agent does not have a verified FUB user mapping. Sending is blocked.'
      : 'This FUB user mapping is ambiguous. Correct it before sending.';

  return (
    <PromptToastCard
      title="Confirm Paired → FUB"
      description="Review the customer and currently selected agent. Nothing sends until you approve it here."
      submitLabel={canSend ? 'Pair and send to FUB' : 'Move to Paired only'}
      cancelLabel={canSend ? 'Pair without sending' : 'Cancel'}
      onCancel={() => onChoose(canSend ? 'paired_only' : 'cancel')}
      onSubmit={() => onChoose(canSend ? 'send' : 'paired_only')}
    >
      <dl className="space-y-3 rounded-md border border-border bg-surface-muted px-3 py-2.5 text-sm">
        <div>
          <dt className="text-xs text-foreground-subtle">Customer</dt>
          <dd className="font-semibold text-foreground">{preview.customerName}</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground-subtle">Selected agent</dt>
          <dd className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
            {preview.selectedAgentName}
            {preview.selectionSource === 'manual' ? (
              <Badge variant="info">Manual override</Badge>
            ) : null}
          </dd>
        </div>
      </dl>
      {preview.existingPersonId ? (
        <p className="text-xs leading-4 text-foreground-subtle">
          Existing FUB customer {preview.existingPersonId} will be preserved.
        </p>
      ) : null}
      {!canSend ? <p className={promptToastWarningClasses}>{mappingMessage}</p> : null}
    </PromptToastCard>
  );
}

export function confirmPairedFubSend(
  preview: MockFubApprovalPreview,
): Promise<PairedFubChoice> {
  return openPromptToast<PairedFubChoice>(
    (finalize) => (
      <PairedFubConfirmationCard preview={preview} onChoose={finalize} />
    ),
    'cancel',
  );
}

export function fubSendOutcomeMessage(
  status: FubSendUiStatus,
  recovered: boolean,
): { kind: 'info' | 'success' | 'error'; message: string } {
  switch (status) {
    case 'pending':
    case 'running':
      return {
        kind: 'info',
        message: 'Paired saved. FUB updates are still pending.',
      };
    case 'success':
      return {
        kind: 'success',
        message: recovered
          ? 'Paired saved. The FUB send recovered and finished.'
          : 'Paired saved and sent to Follow Up Boss.',
      };
    case 'partial_failure':
      return {
        kind: 'error',
        message: 'Paired saved. The FUB send is incomplete and can be retried.',
      };
    case 'ambiguous':
      return {
        kind: 'error',
        message:
          'Paired saved. The FUB result is uncertain, so it was not resent.',
      };
    default: {
      const exhaustive: never = status;
      return {
        kind: 'error',
        message: `Unhandled FUB status: ${exhaustive}`,
      };
    }
  }
}
