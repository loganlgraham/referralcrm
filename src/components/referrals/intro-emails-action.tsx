'use client';

import { type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { formatInTimeZone } from 'date-fns-tz';
import { ChevronDown, ChevronRight, Send } from 'lucide-react';
import { toast } from 'sonner';

import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import type { Contact } from '@/components/referrals/contact-assignment';
import { railTextButtonClasses } from '@/components/referrals/referral-rail';

/** Quiet inset panel used for secondary content inside the preview modal. */
const nestedPanelClasses = 'rounded-lg border border-border bg-surface-muted p-3';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeCcInputs = (values: string[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0)
    )
  );

function CcRecipientFields({
  label,
  values,
  onValuesChange,
  disabled = false,
}: {
  label: string;
  values: string[];
  onValuesChange: (updater: (previous: string[]) => string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-foreground-subtle">{label}</p>
      {values.map((value, index) => (
        <Input
          key={index}
          type="email"
          inputMode="email"
          placeholder="name@example.com"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const nextValue = event.target.value;
            onValuesChange((previous) =>
              previous.map((entry, entryIndex) => (entryIndex === index ? nextValue : entry))
            );
          }}
        />
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => onValuesChange((previous) => [...previous, ''])}
      >
        + Add CC recipient
      </Button>
    </div>
  );
}

const describeContact = (contact: Contact | null): string | null => {
  if (!contact) return null;
  const name = contact.name?.trim();
  const email = contact.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || null;
};

function RecipientToggle({
  label,
  detail,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
      />
      <span>
        <span className="font-medium">{label}</span>
        <span className="text-foreground-muted"> — {detail}</span>
      </span>
    </label>
  );
}

const extractFirstName = (name?: string | null, fallback = ''): string => {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  const [first] = trimmed.split(/\s+/);
  return first || fallback;
};

const buildBorrowerFirstName = (referral: any): string => {
  const borrower = referral?.borrower ?? {};
  return (
    extractFirstName(borrower.firstName, '') ||
    extractFirstName(borrower.name, '') ||
    'there'
  );
};

export const buildIntroClipboardTemplate = (
  referral: any,
  buyingAgent: Contact | null,
  sellingAgent: Contact | null,
  mcContact: Contact | null
): string => {
  const borrowerFirstName = buildBorrowerFirstName(referral);
  const isSellerOnly = referral.clientType === 'Seller';
  const buyerFullName = buyingAgent?.name ?? 'your buying agent';
  const buyerPhone = buyingAgent?.phone ?? 'Not provided';
  const buyerEmail = buyingAgent?.email ?? 'Not provided';
  const buyerFirstName = extractFirstName(buyingAgent?.name, 'your buying agent');
  const sellerFullName = sellingAgent?.name ?? 'your selling agent';
  const sellerPhone = sellingAgent?.phone ?? 'Not provided';
  const sellerEmail = sellingAgent?.email ?? 'Not provided';
  const sellerFirstName = extractFirstName(sellingAgent?.name, 'your selling agent');
  const mcFirstName = extractFirstName(mcContact?.name, 'me');

  const buyingAgentBlock = [buyerFullName, buyerPhone, buyerEmail].join('\n');
  const sellingAgentBlock = [sellerFullName, sellerPhone, sellerEmail].join('\n');

  if (isSellerOnly) {
    const agentsIntro = `${sellerFullName}, a local and trusted Real Estate Specialist who will be assisting you with selling your home.`;

    return (
      `Hi ${borrowerFirstName},\n\n` +
      'I want to thank you again for your interest in our Agent Concierge Program. This program is tailored to support clients like you as you navigate the home-selling process with American Financing and to connect you with top-tier local agents.\n\n' +
      `I'm excited to introduce you to ${agentsIntro}\n\n` +
      `Below are ${sellerFirstName}'s contact details. You can expect them to reach out to you shortly:\n\n` +
      'Selling Agent\n' +
      `${sellingAgentBlock}\n\n` +
      `If, at any point, you have trouble reaching ${sellerFirstName} or are not fully satisfied with the services provided, please don't hesitate to contact me. We are committed to supporting you every step of the way.\n\n` +
      'Thank you once again, and best of luck with your home sale!\n\n---'
    );
  }

  const agentsIntro = buyingAgent && sellingAgent
    ? `${buyerFullName} and ${sellerFullName}, both local and trusted Real Estate Specialists who will be assisting you with your home purchase.`
    : `${buyerFullName}, a local and trusted Real Estate Specialist who will be assisting you with your home purchase.`;

  const dualAgents = Boolean(buyingAgent && sellingAgent);

  return (
    `Hi ${borrowerFirstName},\n\n` +
    'I want to thank you again for your interest in our Agent Concierge Program. This program is tailored to support clients like you as you navigate the home-buying and selling process with American Financing and to connect you with top-tier local agents.\n\n' +
    `I'm excited to introduce you to ${agentsIntro}\n\n` +
    `Below are ${dualAgents ? `${buyerFirstName} and ${sellerFirstName}` : buyerFirstName}'s contact details. You can expect them to reach out to you shortly:\n\n` +
    'Buying Agent\n' +
    `${buyingAgentBlock}\n\n` +
    (dualAgents ? `Selling Agent\n${sellingAgentBlock}\n\n` : '') +
    `If, at any point, you have trouble reaching ${dualAgents ? `${buyerFirstName} or ${sellerFirstName}` : buyerFirstName} or are not fully satisfied with the services provided, please don't hesitate to contact ${mcFirstName} or me. We are committed to supporting you every step of the way.\n\n` +
    'Thank you once again, and happy home shopping!\n\n---'
  );
};

interface IntroEmailsActionProps {
  referral: any;
  buyingAgent: Contact | null;
  sellingAgent: Contact | null;
  mcContact: Contact | null;
  showAgentCcField: boolean;
  showMcCcField: boolean;
  /** Rendered beside the "Send intros" button so the Team card can show a two-button action row. */
  secondaryAction?: ReactNode;
  /** Rendered under the action row, before the intro-note disclosure (e.g. request-update status). */
  statusSlot?: ReactNode;
}

/**
 * Owns the intro-email flow for the admin referral page: optional note, preview/cleanup modal,
 * CC recipients, send, and the Gmail clipboard copy. Rendered inside the Team card.
 */
export function IntroEmailsAction({
  referral,
  buyingAgent,
  sellingAgent,
  mcContact,
  showAgentCcField,
  showMcCcField,
  secondaryAction,
  statusSlot,
}: IntroEmailsActionProps) {
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const activityFeedKey = `/api/referrals/${referral._id}/activities`;

  const [sendingIntroductions, setSendingIntroductions] = useState(false);
  const [showNoteField, setShowNoteField] = useState(false);
  const [introNotes, setIntroNotes] = useState('');
  const [cleanedNotes, setCleanedNotes] = useState('');
  const [agentCcInputs, setAgentCcInputs] = useState<string[]>(['']);
  const [mcCcInputs, setMcCcInputs] = useState<string[]>(['']);
  const [sendToAgent, setSendToAgent] = useState(true);
  const [sendToMc, setSendToMc] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  const [cleaningNotes, setCleaningNotes] = useState(false);
  const [introEmailStatus, setIntroEmailStatus] = useState<{
    summary: string;
    sentAt: Date;
  } | null>(null);

  const busy = sendingIntroductions || cleaningNotes;
  const agentSelected = showAgentCcField && sendToAgent;
  const mcSelected = showMcCcField && sendToMc;
  const hasAnyRecipientOption = showAgentCcField || showMcCcField;
  const noRecipientSelected = hasAnyRecipientOption && !agentSelected && !mcSelected;
  const agentRecipientDetail =
    [buyingAgent, sellingAgent]
      .map(describeContact)
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index)
      .join(', ') || 'No agent assigned';
  const mcRecipientDetail = describeContact(mcContact) ?? 'No mortgage consultant assigned';

  const resetRecipientSelections = () => {
    setAgentCcInputs(['']);
    setMcCcInputs(['']);
    setSendToAgent(true);
    setSendToMc(true);
  };

  const handlePreviewIntroductions = async () => {
    if (!introNotes.trim()) {
      setCleanedNotes('');
      setShowPreview(true);
      return;
    }

    setCleaningNotes(true);
    try {
      const response = await fetch(`/api/referrals/${referral._id}/cleanup-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: introNotes }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCleanedNotes(introNotes);
        toast.error('Could not clean up notes, using original text.');
      } else {
        setCleanedNotes(payload.cleanedNotes || introNotes);
      }
      setShowPreview(true);
    } catch (error) {
      console.error('Failed to clean up notes', error);
      setCleanedNotes(introNotes);
      setShowPreview(true);
    } finally {
      setCleaningNotes(false);
    }
  };

  const handleConfirmSend = async () => {
    if (noRecipientSelected) {
      toast.error('Select at least one recipient.');
      return;
    }
    const agentCcRecipients = agentSelected ? normalizeCcInputs(agentCcInputs) : [];
    const mcCcRecipients = mcSelected ? normalizeCcInputs(mcCcInputs) : [];
    const invalidCc = [...agentCcRecipients, ...mcCcRecipients].find(
      (email) => !EMAIL_REGEX.test(email)
    );
    if (invalidCc) {
      toast.error(`"${invalidCc}" is not a valid email address.`);
      return;
    }

    setSendingIntroductions(true);
    setShowPreview(false);
    try {
      const response = await fetch(`/api/referrals/${referral._id}/send-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: cleanedNotes,
          agentCcRecipients,
          mcCcRecipients,
          sendToAgent,
          sendToMc,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof payload?.error === 'string' ? payload.error : 'Unable to send intro emails right now.';
        throw new Error(message);
      }

      const sent = Array.isArray(payload?.sent) ? payload.sent : [];
      const skipped = Array.isArray(payload?.skipped) ? payload.skipped : [];
      const errors = Array.isArray(payload?.errors) ? payload.errors : [];

      const summaryParts: string[] = [];
      if (sent.length > 0) {
        summaryParts.push(`Sent to ${sent.join(', ')}`);
      }
      if (skipped.length > 0) {
        summaryParts.push(`Skipped ${skipped.join(', ')} (missing email)`);
      }
      if (errors.length > 0) {
        summaryParts.push(`Failed for ${errors.join(', ')}`);
      }
      if (agentCcRecipients.length > 0 && sent.includes('agent')) {
        summaryParts.push(`Copied on the agent email: ${agentCcRecipients.join(', ')}`);
      }
      if (mcCcRecipients.length > 0 && sent.includes('mc')) {
        summaryParts.push(`Copied on the MC email: ${mcCcRecipients.join(', ')}`);
      }

      const summary = summaryParts.join('. ');
      if (errors.length > 0) {
        toast.error(summary || 'Some emails could not be sent.');
      } else if (sent.length > 0) {
        toast.success(summary || 'Intro emails sent.');
      } else {
        toast.info(summary || 'No emails were sent.');
      }

      void mutate(activityFeedKey);
      if (cleanedNotes.trim() && sent.some((label: unknown) => typeof label === 'string' && label.startsWith('agent'))) {
        router.refresh();
      }

      const clipboardContent = buildIntroClipboardTemplate(referral, buyingAgent, sellingAgent, mcContact);

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(clipboardContent).catch((error) => {
          console.error('Failed to copy intro email to clipboard', error);
        });
      }

      setIntroEmailStatus({
        summary: summary || 'Intro emails sent.',
        sentAt: new Date(),
      });
      setIntroNotes('');
      setCleanedNotes('');
      setShowNoteField(false);
      resetRecipientSelections();
    } catch (error) {
      console.error('Failed to send intro emails', error);
      toast.error(error instanceof Error ? error.message : 'Unable to send intro emails right now.');
    } finally {
      setSendingIntroductions(false);
    }
  };

  const handleCancelPreview = () => {
    setShowPreview(false);
    setCleanedNotes('');
    resetRecipientSelections();
  };

  const handleRecopyIntroEmail = async () => {
    try {
      const clipboardContent = buildIntroClipboardTemplate(referral, buyingAgent, sellingAgent, mcContact);

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipboardContent);
        toast.success('Intro email template copied to clipboard');
      } else {
        toast.error('Clipboard access is not available');
      }
    } catch (error) {
      console.error('Failed to copy intro email to clipboard', error);
      toast.error('Failed to copy intro email template to clipboard');
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={handlePreviewIntroductions}
          loading={busy}
          leadingIcon={<Send className="h-3.5 w-3.5" />}
        >
          {sendingIntroductions ? 'Sending…' : cleaningNotes ? 'Preparing…' : 'Send intros'}
        </Button>
        {secondaryAction ?? <span aria-hidden />}
      </div>

      {statusSlot}

      <div>
        <button
          type="button"
          onClick={() => setShowNoteField((previous) => !previous)}
          aria-expanded={showNoteField}
          className={cn(railTextButtonClasses, 'inline-flex items-center gap-1')}
        >
          {showNoteField ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          )}
          Add a note to the agent intro
        </button>
        {showNoteField ? (
          <Textarea
            value={introNotes}
            onChange={(event) => setIntroNotes(event.target.value)}
            rows={2}
            className="mt-2"
            placeholder="Included in the agent email (optional)"
            disabled={busy}
          />
        ) : null}
      </div>

      {introEmailStatus ? (
        <div className="space-y-2 rounded-lg bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
          <p>{introEmailStatus.summary}</p>
          <p>
            Copied intro email for Gmail and sent at{' '}
            {formatInTimeZone(new Date(introEmailStatus.sentAt), SLA_TIME_ZONE, "h:mm a 'MT'")}.
          </p>
          <button type="button" onClick={handleRecopyIntroEmail} className={railTextButtonClasses}>
            Re-copy intro email
          </button>
        </div>
      ) : null}

      {showPreview && typeof document !== 'undefined'
        ? createPortal(
        <div className="fixed inset-0 z-50 m-0 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-border bg-surface-raised p-6 shadow-card">
            <h3 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">
              Preview Email Notes
            </h3>
            <p className="mt-1 text-sm text-foreground-subtle">
              Review the cleaned-up notes before sending to the agent.
            </p>
            {cleanedNotes ? (
              <div className={cn('mt-4', nestedPanelClasses)}>
                <p className="text-xs font-medium text-foreground-subtle">Notes (cleaned up)</p>
                <Textarea
                  value={cleanedNotes}
                  onChange={(event) => setCleanedNotes(event.target.value)}
                  rows={4}
                  className="mt-2"
                />
              </div>
            ) : (
              <div className={cn('mt-4', nestedPanelClasses)}>
                <p className="text-sm text-foreground-muted">No notes will be included in the email.</p>
              </div>
            )}
            {hasAnyRecipientOption && (
              <div className={cn('mt-4 space-y-3', nestedPanelClasses)}>
                <p className="text-xs font-medium text-foreground-subtle">Send to</p>
                {showAgentCcField && (
                  <RecipientToggle
                    label="Agent"
                    detail={agentRecipientDetail}
                    checked={sendToAgent}
                    onCheckedChange={setSendToAgent}
                    disabled={sendingIntroductions}
                  />
                )}
                {showMcCcField && (
                  <RecipientToggle
                    label="Mortgage consultant"
                    detail={mcRecipientDetail}
                    checked={sendToMc}
                    onCheckedChange={setSendToMc}
                    disabled={sendingIntroductions}
                  />
                )}
                {showAgentCcField && !sendToAgent && cleanedNotes.trim() ? (
                  <p className="text-xs text-foreground-muted">Notes are only included in the agent email.</p>
                ) : null}
                {noRecipientSelected ? (
                  <p className="text-xs text-foreground-muted">Select at least one recipient to send.</p>
                ) : null}
              </div>
            )}
            {hasAnyRecipientOption && (
              <div className={cn('mt-4 space-y-4', nestedPanelClasses)}>
                <p className="text-sm text-foreground-muted">
                  Copy other people on these emails. The referral coordinator is always copied.
                </p>
                {showAgentCcField && (
                  <div className={cn(!sendToAgent && 'opacity-50')}>
                    <CcRecipientFields
                      label="CC on the agent email (optional)"
                      values={agentCcInputs}
                      onValuesChange={setAgentCcInputs}
                      disabled={sendingIntroductions || !sendToAgent}
                    />
                  </div>
                )}
                {showMcCcField && (
                  <div className={cn(!sendToMc && 'opacity-50')}>
                    <CcRecipientFields
                      label="CC on the mortgage consultant email (optional)"
                      values={mcCcInputs}
                      onValuesChange={setMcCcInputs}
                      disabled={sendingIntroductions || !sendToMc}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={handleCancelPreview}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmSend}
                loading={sendingIntroductions}
                disabled={noRecipientSelected}
              >
                {sendingIntroductions ? 'Sending…' : 'Confirm & Send'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}
