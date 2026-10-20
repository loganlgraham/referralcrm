'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { getLostReasonOptions, type LostReason } from '@/constants/referrals';
import { TERMINATED_REASON_OPTIONS, type TerminatedReason } from '@/constants/deals';
import { selectFieldClasses } from '@/components/ui/field-group';
import {
  openPromptToast,
  promptToastHintClasses,
  PromptToastCard,
  PromptToastField
} from '@/components/referrals/prompt-toast-shell';

type StillShoppingAnswer = 'yes' | 'no' | 'maybe';

export type TerminationResolvedStatus = 'Active Lead' | 'Lost' | 'In Communication';

export interface ReferralTerminationResult {
  confirmed: boolean;
  /** Yes → Active Lead, No → Lost, Maybe → In Communication. */
  resolvedStatus?: TerminationResolvedStatus;
  terminatedReason?: TerminatedReason;
  lostReason?: LostReason | null;
}

const CANCELLED_REFERRAL_TERMINATION: ReferralTerminationResult = { confirmed: false };

function resolveShoppingStatus(answer: StillShoppingAnswer): TerminationResolvedStatus {
  switch (answer) {
    case 'yes':
      return 'Active Lead';
    case 'no':
      return 'Lost';
    case 'maybe':
      return 'In Communication';
    default: {
      const exhaustiveCheck: never = answer;
      return exhaustiveCheck;
    }
  }
}

function shoppingHint(answer: StillShoppingAnswer | ''): string {
  switch (answer) {
    case 'yes':
      return 'They stay in your pipeline as an active lead and the deal is closed out.';
    case 'maybe':
      return 'They stay in communication while you figure out next steps, and the deal is closed out.';
    case 'no':
      return 'The deal is closed out along with the referral.';
    case '':
      return 'The deal is closed out. Where the client goes next depends on your answer.';
    default: {
      const exhaustiveCheck: never = answer;
      return exhaustiveCheck;
    }
  }
}

function ReferralTerminationForm({
  borrowerName,
  isAgentOrigin,
  onCancel,
  onConfirm
}: {
  borrowerName: string;
  isAgentOrigin: boolean;
  onCancel: () => void;
  onConfirm: (result: ReferralTerminationResult) => void;
}) {
  const [stillShopping, setStillShopping] = useState<StillShoppingAnswer | ''>('');
  const [terminatedReason, setTerminatedReason] = useState<TerminatedReason | ''>('');
  const [lostReason, setLostReason] = useState<LostReason | ''>('');
  const lostReasonOptions = getLostReasonOptions({ isAgentOrigin });

  const handleSubmit = () => {
    if (!stillShopping) {
      toast.error('Please choose whether the customer is still shopping.');
      return;
    }
    if (!terminatedReason) {
      toast.error('Termination reason is required.');
      return;
    }
    const resolvedStatus = resolveShoppingStatus(stillShopping);
    if (resolvedStatus === 'Lost' && !lostReason) {
      toast.error('Please choose why we are losing this client.');
      return;
    }

    onConfirm({
      confirmed: true,
      resolvedStatus,
      terminatedReason,
      lostReason: resolvedStatus === 'Lost' ? (lostReason as LostReason) : null
    });
  };

  return (
    <PromptToastCard
      title="The deal fell through"
      description={`Tell us what happened so ${borrowerName} lands in the right place.`}
      submitLabel="Confirm"
      onCancel={onCancel}
      onSubmit={handleSubmit}
    >
      <PromptToastField label="Is this customer still shopping?">
        <select
          autoFocus
          value={stillShopping}
          onChange={(event) => setStillShopping(event.target.value as StillShoppingAnswer | '')}
          className={selectFieldClasses}
        >
          <option value="">Select</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
          <option value="maybe">Maybe</option>
        </select>
      </PromptToastField>

      <PromptToastField label="Why did the deal fall through?">
        <select
          value={terminatedReason}
          onChange={(event) => setTerminatedReason(event.target.value as TerminatedReason | '')}
          className={selectFieldClasses}
        >
          <option value="">Select reason</option>
          {TERMINATED_REASON_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </PromptToastField>

      {stillShopping === 'no' ? (
        <PromptToastField label="Why are we losing this client?">
          <select
            value={lostReason}
            onChange={(event) => setLostReason(event.target.value as LostReason | '')}
            className={selectFieldClasses}
          >
            <option value="">Select reason</option>
            {lostReasonOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </PromptToastField>
      ) : null}

      <p className={promptToastHintClasses}>{shoppingHint(stillShopping)}</p>
    </PromptToastCard>
  );
}

/**
 * Terminating a deal never writes `Terminated` straight through: the answer
 * decides whether the client stays an Active Lead, stays in communication, or
 * is marked Lost, and the API requires the matching reasons alongside the
 * terminated deal.
 */
export function confirmReferralTermination(options: {
  borrowerName: string;
  isAgentOrigin: boolean;
}): Promise<ReferralTerminationResult> {
  return openPromptToast<ReferralTerminationResult>(
    (finalize) => (
      <ReferralTerminationForm
        borrowerName={options.borrowerName}
        isAgentOrigin={options.isAgentOrigin}
        onCancel={() => finalize(CANCELLED_REFERRAL_TERMINATION)}
        onConfirm={finalize}
      />
    ),
    CANCELLED_REFERRAL_TERMINATION
  );
}
