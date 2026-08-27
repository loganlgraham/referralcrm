'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { inputFieldClasses } from '@/components/ui/input';
import {
  openPromptToast,
  promptToastCheckboxClasses,
  promptToastCheckLabelClasses,
  promptToastRadioClasses,
  promptToastRadioLabelClasses,
  promptToastWarningClasses,
  PromptToastCard,
  PromptToastField,
  PromptToastFieldset
} from '@/components/referrals/prompt-toast-shell';

type CloseStatusConfirmationOptions = {
  initialDateIso?: string | null;
  canSendClosedEmails: boolean;
  defaultSendClosedEmails?: boolean;
  canSendAgentNpsEmail?: boolean;
  defaultSendAgentNpsEmail?: boolean;
  showEmailPreference?: boolean;
  /** Ask whether the client financed with AFC (buy-side only). */
  askUsedAfc?: boolean;
  defaultUsedAfc?: boolean;
};

type PaidStatusConfirmationOptions = {
  initialDateIso?: string | null;
};

type SendFeeBreakdownConfirmationOptions = {
  message: string;
};

export type CloseStatusConfirmationResult = {
  confirmed: boolean;
  closingDateIso?: string;
  sendClosedEmails: boolean;
  sendAgentNpsEmail: boolean;
  usedAfc?: boolean;
};

export type PaidStatusConfirmationResult = {
  confirmed: boolean;
  paidDateIso?: string;
};

export type SendFeeBreakdownConfirmationResult = {
  confirmed: boolean;
  additionalCcRecipients?: string[];
};

type ConfirmationKind = 'closed' | 'paid';

type DateConfirmationResult = {
  confirmed: boolean;
  dateIso?: string;
  sendClosedEmails: boolean;
  sendAgentNpsEmail: boolean;
  usedAfc?: boolean;
};

const CANCELLED_DATE_CONFIRMATION: DateConfirmationResult = {
  confirmed: false,
  sendClosedEmails: false,
  sendAgentNpsEmail: false
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toDateInputValue = (sourceIso?: string | null): string => {
  if (typeof sourceIso === 'string' && sourceIso.length >= 10) {
    return sourceIso.slice(0, 10);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateInputToIso = (dateValue: string): string => {
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(year, month - 1, day).toISOString();
};

interface DateConfirmationFormProps {
  kind: ConfirmationKind;
  initialDateIso?: string | null;
  canSendClosedEmails: boolean;
  defaultSendClosedEmails: boolean;
  canSendAgentNpsEmail: boolean;
  defaultSendAgentNpsEmail: boolean;
  showEmailPreference: boolean;
  askUsedAfc: boolean;
  defaultUsedAfc: boolean;
  onCancel: () => void;
  onConfirm: (result: DateConfirmationResult) => void;
}

function DateConfirmationForm({
  kind,
  initialDateIso,
  canSendClosedEmails,
  defaultSendClosedEmails,
  canSendAgentNpsEmail,
  defaultSendAgentNpsEmail,
  showEmailPreference,
  askUsedAfc,
  defaultUsedAfc,
  onCancel,
  onConfirm
}: DateConfirmationFormProps) {
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue(initialDateIso));
  const [sendClosedEmails, setSendClosedEmails] = useState(defaultSendClosedEmails);
  const [sendAgentNpsEmail, setSendAgentNpsEmail] = useState(defaultSendAgentNpsEmail);
  const [usedAfc, setUsedAfc] = useState(defaultUsedAfc);

  const isClose = kind === 'closed';

  return (
    <PromptToastCard
      title={isClose ? 'Confirm close date' : 'Confirm paid date'}
      description={
        isClose
          ? 'Select the closing date before marking this deal as closed.'
          : 'Select the paid date before marking this deal as paid.'
      }
      submitLabel="Confirm"
      onCancel={onCancel}
      onSubmit={() => {
        if (!selectedDate) {
          toast.error('Select a date to continue.');
          return;
        }

        onConfirm({
          confirmed: true,
          dateIso: dateInputToIso(selectedDate),
          sendClosedEmails: isClose ? sendClosedEmails : false,
          sendAgentNpsEmail: isClose ? sendAgentNpsEmail : false,
          usedAfc: askUsedAfc ? usedAfc : undefined
        });
      }}
    >
      <PromptToastField label={isClose ? 'Closing date' : 'Paid date'}>
        <input
          autoFocus
          type="date"
          value={selectedDate}
          onChange={(event) => setSelectedDate(event.target.value)}
          className={cn(inputFieldClasses, 'text-numeric')}
        />
      </PromptToastField>

      {isClose && askUsedAfc ? (
        <PromptToastFieldset
          legend="Is this client financing with AFC?"
          description="Helps keep the client outcome accurate for your partnership view."
        >
          <label className={promptToastRadioLabelClasses}>
            <input
              type="radio"
              name="usedAfcClose"
              checked={usedAfc}
              onChange={() => setUsedAfc(true)}
              className={promptToastRadioClasses}
            />
            Yes — financing with AFC
          </label>
          <label className={promptToastRadioLabelClasses}>
            <input
              type="radio"
              name="usedAfcClose"
              checked={!usedAfc}
              onChange={() => setUsedAfc(false)}
              className={promptToastRadioClasses}
            />
            No — financing with another lender
          </label>
        </PromptToastFieldset>
      ) : null}

      {isClose && showEmailPreference && canSendClosedEmails ? (
        <label className={promptToastCheckLabelClasses}>
          <input
            type="checkbox"
            checked={sendClosedEmails}
            onChange={(event) => setSendClosedEmails(event.target.checked)}
            className={promptToastCheckboxClasses}
          />
          <span>Send a congratulations email to the referral to rate their agent.</span>
        </label>
      ) : null}

      {isClose && showEmailPreference && !canSendClosedEmails ? (
        <p className={promptToastWarningClasses}>
          Referral rating email will not be sent because the assigned agent is not marked as used.
        </p>
      ) : null}

      {isClose && showEmailPreference && canSendAgentNpsEmail ? (
        <label className={promptToastCheckLabelClasses}>
          <input
            type="checkbox"
            checked={sendAgentNpsEmail}
            onChange={(event) => setSendAgentNpsEmail(event.target.checked)}
            className={promptToastCheckboxClasses}
          />
          <span>Send MC NPS email to the agent.</span>
        </label>
      ) : null}
    </PromptToastCard>
  );
}

const openDateConfirmationToast = (options: {
  kind: ConfirmationKind;
  initialDateIso?: string | null;
  canSendClosedEmails?: boolean;
  defaultSendClosedEmails?: boolean;
  showEmailPreference?: boolean;
  canSendAgentNpsEmail?: boolean;
  defaultSendAgentNpsEmail?: boolean;
  askUsedAfc?: boolean;
  defaultUsedAfc?: boolean;
}): Promise<DateConfirmationResult> =>
  openPromptToast<DateConfirmationResult>(
    (finalize) => (
      <DateConfirmationForm
        kind={options.kind}
        initialDateIso={options.initialDateIso}
        canSendClosedEmails={Boolean(options.canSendClosedEmails)}
        defaultSendClosedEmails={options.defaultSendClosedEmails ?? false}
        canSendAgentNpsEmail={Boolean(options.canSendAgentNpsEmail)}
        defaultSendAgentNpsEmail={options.defaultSendAgentNpsEmail ?? false}
        showEmailPreference={options.showEmailPreference ?? true}
        askUsedAfc={Boolean(options.askUsedAfc)}
        defaultUsedAfc={options.defaultUsedAfc ?? true}
        onCancel={() => finalize(CANCELLED_DATE_CONFIRMATION)}
        onConfirm={finalize}
      />
    ),
    CANCELLED_DATE_CONFIRMATION
  );

export const confirmCloseStatusDate = async (
  options: CloseStatusConfirmationOptions
): Promise<CloseStatusConfirmationResult> => {
  const showEmailPreference = options.showEmailPreference ?? true;
  const result = await openDateConfirmationToast({
    kind: 'closed',
    initialDateIso: options.initialDateIso,
    canSendClosedEmails: showEmailPreference ? options.canSendClosedEmails : false,
    defaultSendClosedEmails: showEmailPreference
      ? options.defaultSendClosedEmails ?? options.canSendClosedEmails
      : false,
    canSendAgentNpsEmail: showEmailPreference ? options.canSendAgentNpsEmail : false,
    defaultSendAgentNpsEmail: showEmailPreference
      ? options.defaultSendAgentNpsEmail ?? options.canSendAgentNpsEmail
      : false,
    showEmailPreference,
    askUsedAfc: options.askUsedAfc,
    defaultUsedAfc: options.defaultUsedAfc ?? true,
  });

  return {
    confirmed: result.confirmed,
    closingDateIso: result.dateIso,
    sendClosedEmails: result.sendClosedEmails,
    sendAgentNpsEmail: result.sendAgentNpsEmail,
    usedAfc: result.usedAfc,
  };
};

export const confirmPaidStatusDate = async (
  options: PaidStatusConfirmationOptions
): Promise<PaidStatusConfirmationResult> => {
  const result = await openDateConfirmationToast({
    kind: 'paid',
    initialDateIso: options.initialDateIso,
  });

  return {
    confirmed: result.confirmed,
    paidDateIso: result.dateIso,
  };
};

function FeeBreakdownConfirmationForm({
  message,
  onCancel,
  onConfirm
}: {
  message: string;
  onCancel: () => void;
  onConfirm: (result: SendFeeBreakdownConfirmationResult) => void;
}) {
  const [ccInputs, setCcInputs] = useState<string[]>(['']);

  return (
    <PromptToastCard
      title="Send fee breakdown email"
      description={<span className="whitespace-pre-line">{message}</span>}
      submitLabel="Send"
      onCancel={onCancel}
      onSubmit={() => {
        const normalizedRecipients = Array.from(
          new Set(
            ccInputs.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0)
          )
        );

        const invalidEmail = normalizedRecipients.find((email) => !EMAIL_REGEX.test(email));
        if (invalidEmail) {
          toast.error('Enter valid CC email addresses.');
          return;
        }

        onConfirm({ confirmed: true, additionalCcRecipients: normalizedRecipients });
      }}
    >
      <PromptToastField label="Additional CC recipients (optional)">
        <div className="space-y-2">
          {ccInputs.map((value, index) => (
            <input
              key={index}
              autoFocus={index === 0}
              type="email"
              inputMode="email"
              placeholder="name@example.com"
              value={value}
              onChange={(event) => {
                const nextInputs = [...ccInputs];
                nextInputs[index] = event.target.value;
                setCcInputs(nextInputs);
              }}
              className={inputFieldClasses}
            />
          ))}
        </div>
      </PromptToastField>
      <button
        type="button"
        onClick={() => setCcInputs((current) => [...current, ''])}
        className="text-xs font-medium text-foreground-muted underline-offset-2 transition hover:text-foreground hover:underline"
      >
        + Add CC recipient
      </button>
    </PromptToastCard>
  );
}

export const confirmFeeBreakdownSend = async (
  options: SendFeeBreakdownConfirmationOptions
): Promise<SendFeeBreakdownConfirmationResult> =>
  openPromptToast<SendFeeBreakdownConfirmationResult>(
    (finalize) => (
      <FeeBreakdownConfirmationForm
        message={options.message}
        onCancel={() => finalize({ confirmed: false })}
        onConfirm={finalize}
      />
    ),
    { confirmed: false }
  );
