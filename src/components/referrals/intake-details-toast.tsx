'use client';

import { useState } from 'react';
import { REFERRAL_TIMELINE_OPTIONS } from '@/constants/referrals';
import { cn } from '@/lib/cn';
import { inputFieldClasses } from '@/components/ui/input';
import { selectFieldClasses } from '@/components/ui/field-group';
import {
  openPromptToast,
  PromptToastCard,
  PromptToastField
} from '@/components/referrals/prompt-toast-shell';
import {
  formatCurrencyInputDisplay,
  sanitizeCurrencyInput,
  type DetailDraft,
  type ReferralClientType,
  type TransferStage
} from '@/components/referrals/referral-detail-draft';

interface IntakeDetailsFormProps {
  initialDraft: DetailDraft;
  canEditBorrowerContact: boolean;
  onCancel: () => void;
  onSubmit: (draft: DetailDraft) => Promise<void>;
}

function IntakeDetailsForm({
  initialDraft,
  canEditBorrowerContact,
  onCancel,
  onSubmit
}: IntakeDetailsFormProps) {
  const [draft, setDraft] = useState<DetailDraft>(initialDraft);
  const [submitting, setSubmitting] = useState(false);

  const updateField = <K extends keyof DetailDraft>(field: K, value: DetailDraft[K]) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // Failures keep the toast open so the edits are not lost.
      await onSubmit(draft);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PromptToastCard
      title="Edit intake details"
      description="Update the intake context for this referral."
      width="wide"
      submitLabel={submitting ? 'Saving…' : 'Save changes'}
      submitting={submitting}
      onCancel={onCancel}
      onSubmit={() => void handleSubmit()}
      bodyClassName="grid grid-cols-1 gap-3 space-y-0 sm:grid-cols-2"
    >
      {canEditBorrowerContact ? (
        <>
          <PromptToastField label="Client first name">
            <input
              className={inputFieldClasses}
              value={draft.borrowerFirstName}
              onChange={(event) => updateField('borrowerFirstName', event.target.value)}
            />
          </PromptToastField>
          <PromptToastField label="Client last name">
            <input
              className={inputFieldClasses}
              value={draft.borrowerLastName}
              onChange={(event) => updateField('borrowerLastName', event.target.value)}
            />
          </PromptToastField>
          <PromptToastField label="Client email">
            <input
              type="email"
              className={inputFieldClasses}
              value={draft.borrowerEmail}
              onChange={(event) => updateField('borrowerEmail', event.target.value)}
            />
          </PromptToastField>
          <PromptToastField label="Client phone">
            <input
              type="tel"
              className={cn(inputFieldClasses, 'text-numeric')}
              value={draft.borrowerPhone}
              onChange={(event) => updateField('borrowerPhone', event.target.value)}
            />
          </PromptToastField>
        </>
      ) : null}

      <PromptToastField label="Client">
        <select
          className={selectFieldClasses}
          value={draft.clientType}
          onChange={(event) => updateField('clientType', event.target.value as ReferralClientType)}
        >
          <option value="Buyer">Buyer</option>
          <option value="Seller">Seller</option>
          <option value="Both">Both</option>
        </select>
      </PromptToastField>
      <PromptToastField label="Loan type">
        <input
          className={inputFieldClasses}
          value={draft.loanType}
          onChange={(event) => updateField('loanType', event.target.value)}
        />
      </PromptToastField>

      <PromptToastField label="Pre-approval">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-subtle">
            $
          </span>
          <input
            className={cn(inputFieldClasses, 'text-numeric pl-6')}
            inputMode="decimal"
            placeholder="300,000"
            value={formatCurrencyInputDisplay(draft.preApprovalAmount)}
            onChange={(event) =>
              updateField('preApprovalAmount', sanitizeCurrencyInput(event.target.value))
            }
          />
        </div>
      </PromptToastField>
      <PromptToastField label="Looking in (ZIP)">
        <input
          className={cn(inputFieldClasses, 'text-numeric')}
          value={draft.lookingInZip}
          onChange={(event) => updateField('lookingInZip', event.target.value)}
        />
      </PromptToastField>

      <PromptToastField label="Stage on transfer">
        <select
          className={selectFieldClasses}
          value={draft.stageOnTransfer}
          onChange={(event) => updateField('stageOnTransfer', event.target.value as TransferStage)}
        >
          <option value="Pre-approval TBD">Pre-approval TBD</option>
          <option value="Pre-approved">Pre-approved</option>
        </select>
      </PromptToastField>
      <PromptToastField label="Timeline">
        <select
          className={selectFieldClasses}
          value={draft.timeline}
          onChange={(event) => updateField('timeline', event.target.value as DetailDraft['timeline'])}
        >
          {REFERRAL_TIMELINE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </PromptToastField>

      <PromptToastField label="Current address" className="sm:col-span-2">
        <input
          className={inputFieldClasses}
          value={draft.borrowerCurrentAddress}
          onChange={(event) => updateField('borrowerCurrentAddress', event.target.value)}
        />
      </PromptToastField>
    </PromptToastCard>
  );
}

/**
 * Edits the intake facts in place instead of revealing a form further down the
 * page. Like the deal toast, the card owns the save: it stays open with a
 * spinner while `onSubmit` runs and only closes once the save reports success.
 */
export function collectIntakeDetails(options: {
  initialDraft: DetailDraft;
  canEditBorrowerContact: boolean;
  onSubmit: (draft: DetailDraft) => Promise<boolean>;
}): Promise<boolean> {
  return openPromptToast<boolean>(
    (finalize) => (
      <IntakeDetailsForm
        initialDraft={options.initialDraft}
        canEditBorrowerContact={options.canEditBorrowerContact}
        onCancel={() => finalize(false)}
        onSubmit={async (draft) => {
          const saved = await options.onSubmit(draft);
          if (saved) {
            finalize(true);
          }
        }}
      />
    ),
    false
  );
}
