'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { getLostReasonOptions, type LostReason } from '@/constants/referrals';
import { selectFieldClasses } from '@/components/ui/field-group';
import {
  openPromptToast,
  promptToastHintClasses,
  PromptToastCard,
  PromptToastField
} from '@/components/referrals/prompt-toast-shell';

export interface LostReasonConfirmationResult {
  confirmed: boolean;
  lostReason?: LostReason;
}

const CANCELLED: LostReasonConfirmationResult = { confirmed: false };

interface LostReasonFormProps {
  borrowerName: string;
  isAgentOrigin: boolean;
  onCancel: () => void;
  onConfirm: (reason: LostReason) => void;
}

function LostReasonForm({ borrowerName, isAgentOrigin, onCancel, onConfirm }: LostReasonFormProps) {
  const options = getLostReasonOptions({ isAgentOrigin });
  const [reason, setReason] = useState<LostReason | ''>('');

  return (
    <PromptToastCard
      title="Why did this fall through?"
      description={`A reason is required before marking ${borrowerName} as Lost.`}
      submitLabel="Mark as Lost"
      onCancel={onCancel}
      onSubmit={() => {
        if (!reason) {
          toast.error('Pick a reason to continue.');
          return;
        }
        onConfirm(reason);
      }}
    >
      <PromptToastField label="Reason">
        <select
          autoFocus
          value={reason}
          onChange={(event) => setReason(event.target.value as LostReason)}
          className={selectFieldClasses}
        >
          <option value="">Select a reason…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </PromptToastField>
      {!isAgentOrigin ? (
        <p className={promptToastHintClasses}>
          Losses that happened before the agent could reach the borrower are not counted against the
          agent.
        </p>
      ) : null}
    </PromptToastCard>
  );
}

/**
 * `Lost` is rejected server-side without a reason, so the chip row routes
 * through this confirmation instead of disabling the chip.
 */
export function confirmLostReason(options: {
  borrowerName: string;
  isAgentOrigin: boolean;
}): Promise<LostReasonConfirmationResult> {
  return openPromptToast<LostReasonConfirmationResult>(
    (finalize) => (
      <LostReasonForm
        borrowerName={options.borrowerName}
        isAgentOrigin={options.isAgentOrigin}
        onCancel={() => finalize(CANCELLED)}
        onConfirm={(lostReason) => finalize({ confirmed: true, lostReason })}
      />
    ),
    CANCELLED
  );
}
