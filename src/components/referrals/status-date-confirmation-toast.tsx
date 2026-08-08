'use client';

import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

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
}): Promise<{
  confirmed: boolean;
  dateIso?: string;
  sendClosedEmails: boolean;
  sendAgentNpsEmail: boolean;
  usedAfc?: boolean;
}> =>
  new Promise((resolve) => {
    let selectedDate = toDateInputValue(options.initialDateIso);
    let sendClosedEmails = options.defaultSendClosedEmails ?? false;
    let sendAgentNpsEmail = options.defaultSendAgentNpsEmail ?? false;
    let usedAfc = options.defaultUsedAfc ?? true;
    let settled = false;

    const finalize = (result: {
      confirmed: boolean;
      dateIso?: string;
      sendClosedEmails: boolean;
      sendAgentNpsEmail: boolean;
      usedAfc?: boolean;
    }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
      toast.dismiss(toastId);
    };

    const isClose = options.kind === 'closed';
    const showEmailPreference = options.showEmailPreference ?? true;
    const askUsedAfc = Boolean(options.askUsedAfc);
    const title = isClose ? 'Confirm close date' : 'Confirm paid date';
    const description = isClose
      ? 'Select the closing date before marking this deal as closed.'
      : 'Select the paid date before marking this deal as paid.';

    const toastId = toast.custom(
      () => (
        <form
          className="w-[360px] rounded-lg border border-border bg-surface-raised p-4 shadow-lg"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedDate) {
              toast.error('Select a date to continue.');
              return;
            }

            finalize({
              confirmed: true,
              dateIso: dateInputToIso(selectedDate),
              sendClosedEmails: isClose ? sendClosedEmails : false,
              sendAgentNpsEmail: isClose ? sendAgentNpsEmail : false,
              usedAfc: askUsedAfc ? usedAfc : undefined,
            });
          }}
        >
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-xs text-foreground-subtle">{description}</p>

          <label className="mt-3 block text-xs font-semibold text-foreground-muted">
            {isClose ? 'Closing date' : 'Paid date'}
            <input
              autoFocus
              type="date"
              defaultValue={selectedDate}
              onChange={(event) => {
                selectedDate = event.target.value;
              }}
              className="mt-1 w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none"
            />
          </label>

          {isClose && askUsedAfc ? (
            <fieldset className="mt-3 rounded border border-primary/30 bg-primary/5 p-3">
              <legend className="px-1 text-xs font-semibold text-foreground">
                Is this client financing with AFC?
              </legend>
              <p className="mt-1 text-xs text-foreground-subtle">
                Helps keep the client outcome accurate for your partnership view.
              </p>
              <div className="mt-2 flex flex-col gap-2 text-xs text-foreground-muted">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="usedAfcClose"
                    defaultChecked={usedAfc}
                    onChange={() => {
                      usedAfc = true;
                    }}
                    className="h-4 w-4 accent-brand"
                  />
                  Yes — financing with AFC
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    name="usedAfcClose"
                    defaultChecked={!usedAfc}
                    onChange={() => {
                      usedAfc = false;
                    }}
                    className="h-4 w-4 accent-brand"
                  />
                  No — financing with another lender
                </label>
              </div>
            </fieldset>
          ) : null}

          {isClose && showEmailPreference && options.canSendClosedEmails ? (
            <label className="mt-3 flex items-start gap-2 rounded border border-border bg-surface-muted p-2 text-xs text-foreground-muted">
              <input
                type="checkbox"
                defaultChecked={sendClosedEmails}
                onChange={(event) => {
                  sendClosedEmails = event.target.checked;
                }}
                className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
              />
              <span>Send a congratulations email to the referral to rate their agent.</span>
            </label>
          ) : null}

          {isClose && showEmailPreference && !options.canSendClosedEmails ? (
            <p className="mt-3 rounded border border-warning/30 bg-warning-soft px-2 py-1 text-xs text-warning">
              Referral rating email will not be sent because the assigned agent is not marked as used.
            </p>
          ) : null}

          {isClose && showEmailPreference && options.canSendAgentNpsEmail ? (
            <label className="mt-3 flex items-start gap-2 rounded border border-border bg-surface-muted p-2 text-xs text-foreground-muted">
              <input
                type="checkbox"
                defaultChecked={sendAgentNpsEmail}
                onChange={(event) => {
                  sendAgentNpsEmail = event.target.checked;
                }}
                className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
              />
              <span>Send MC NPS email to the agent.</span>
            </label>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                finalize({ confirmed: false, sendClosedEmails: false, sendAgentNpsEmail: false })
              }
              className="rounded border border-border-strong bg-surface-raised px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-hover"
            >
              Confirm
            </button>
          </div>
        </form>
      ),
      {
        duration: Infinity,
        position: 'top-center',
        closeButton: false,
        onDismiss: () => {
          if (!settled) {
            resolve({ confirmed: false, sendClosedEmails: false, sendAgentNpsEmail: false });
            settled = true;
          }
        },
        onAutoClose: () => {
          if (!settled) {
            resolve({ confirmed: false, sendClosedEmails: false, sendAgentNpsEmail: false });
            settled = true;
          }
        },
      }
    );

  });

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

export const confirmFeeBreakdownSend = async (
  options: SendFeeBreakdownConfirmationOptions
): Promise<SendFeeBreakdownConfirmationResult> =>
  new Promise((resolve) => {
    let settled = false;

    const finalize = (result: SendFeeBreakdownConfirmationResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
      toast.dismiss(toastId);
    };

    const FeeBreakdownConfirmationForm = () => {
      const [ccInputs, setCcInputs] = useState<string[]>(['']);

      const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedRecipients = Array.from(
          new Set(
            ccInputs
              .map((value) => value.trim().toLowerCase())
              .filter((value) => value.length > 0)
          )
        );

        const invalidEmail = normalizedRecipients.find((email) => !EMAIL_REGEX.test(email));
        if (invalidEmail) {
          toast.error('Enter valid CC email addresses.');
          return;
        }

        finalize({
          confirmed: true,
          additionalCcRecipients: normalizedRecipients,
        });
      };

      return (
        <form
          className="w-[420px] rounded-lg border border-border bg-surface-raised p-4 shadow-lg"
          onSubmit={handleSubmit}
        >
          <p className="text-sm font-semibold text-foreground">Send fee breakdown email</p>
          <p className="mt-1 whitespace-pre-line text-xs text-foreground-subtle">{options.message}</p>

          <div className="mt-3 space-y-2">
            <p className="text-xs font-semibold text-foreground-muted">Additional CC recipients (optional)</p>
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
                className="w-full rounded border border-border-strong px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none"
              />
            ))}
            <button
              type="button"
              onClick={() => setCcInputs((prev) => [...prev, ''])}
              className="inline-flex items-center rounded border border-border-strong bg-surface-raised px-2 py-1 text-xs font-semibold text-foreground-muted transition hover:bg-surface-muted"
            >
              + Add CC recipient
            </button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => finalize({ confirmed: false })}
              className="rounded border border-border-strong bg-surface-raised px-3 py-1.5 text-xs font-semibold text-foreground-muted transition hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-hover"
            >
              Send
            </button>
          </div>
        </form>
      );
    };

    const toastId = toast.custom(
      () => <FeeBreakdownConfirmationForm />,
      {
        duration: Infinity,
        position: 'top-center',
        closeButton: false,
        onDismiss: () => {
          if (!settled) {
            settled = true;
            resolve({ confirmed: false });
          }
        },
        onAutoClose: () => {
          if (!settled) {
            settled = true;
            resolve({ confirmed: false });
          }
        },
      }
    );
  });
