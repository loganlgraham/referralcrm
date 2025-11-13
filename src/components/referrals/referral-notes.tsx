'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';

interface ReferralNote {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  hiddenFromAgent?: boolean;
  hiddenFromMc?: boolean;
  emailedTargets?: ('agent' | 'mc' | 'admin')[];
}

type DeliveryFailureReason = 'missing_configuration' | 'no_recipients' | 'unknown';

interface ReferralNoteResponse extends ReferralNote {
  deliveryFailed?: boolean;
  deliveryFailureReason?: DeliveryFailureReason;
}

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;

interface Props {
  referralId: string;
  initialNotes: ReferralNote[];
  viewerRole: ViewerRole;
  agentContact?: { name?: string | null; email?: string | null } | null;
  mcContact?: { name?: string | null; email?: string | null } | null;
  adminContacts?: { name?: string | null; email?: string | null }[];
}

const formatTimestamp = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
};

interface ToggleControlProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

function ToggleControl({ label, checked, onChange, disabled }: ToggleControlProps) {
  const handleToggle = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const trackClasses = `relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
    disabled ? 'bg-slate-200' : checked ? 'bg-brand' : 'bg-slate-300'
  }`;

  const thumbClasses = `inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
    checked ? 'translate-x-4' : 'translate-x-1'
  }`;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={handleToggle}
      disabled={disabled}
      className={`inline-flex items-center gap-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-600'
      }`}
    >
      <span className={trackClasses}>
        <span className={thumbClasses} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function ReferralNotes({
  referralId,
  initialNotes,
  viewerRole,
  agentContact,
  mcContact,
  adminContacts,
}: Props) {
  const [notes, setNotes] = useState<ReferralNote[]>(() => [...initialNotes]);
  const [content, setContent] = useState('');
  const [hiddenFromAgent, setHiddenFromAgent] = useState(false);
  const [hiddenFromMc, setHiddenFromMc] = useState(false);
  const [emailAgent, setEmailAgent] = useState(false);
  const [emailMc, setEmailMc] = useState(false);
  const [emailAdmin, setEmailAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNotesDropdown, setShowNotesDropdown] = useState(false);
  const { mutate } = useSWRConfig();

  const activityFeedKey = `/api/referrals/${referralId}/activities`;

  const canControlVisibility = viewerRole === 'admin' || viewerRole === 'manager';
  const hasAgentEmail = Boolean(agentContact?.email);
  const hasMcEmail = Boolean(mcContact?.email);
  const hasAdminEmails = Array.isArray(adminContacts)
    ? adminContacts.some((contact) => contact?.email)
    : false;
  const agentEmailDisabled = saving || hiddenFromAgent || !hasAgentEmail;
  const mcEmailDisabled = saving || hiddenFromMc || !hasMcEmail;
  const adminEmailDisabled = saving || !hasAdminEmails;

  const sortedNotes = useMemo(
    () =>
      [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notes]
  );

  useEffect(() => {
    if (hiddenFromAgent && emailAgent) {
      setEmailAgent(false);
    }
  }, [hiddenFromAgent, emailAgent]);

  useEffect(() => {
    if (hiddenFromMc && emailMc) {
      setEmailMc(false);
    }
  }, [hiddenFromMc, emailMc]);

  useEffect(() => {
    if (!hasAdminEmails && emailAdmin) {
      setEmailAdmin(false);
    }
  }, [hasAdminEmails, emailAdmin]);

  const resetForm = () => {
    setContent('');
    setHiddenFromAgent(false);
    setHiddenFromMc(false);
    setEmailAgent(false);
    setEmailMc(false);
    setEmailAdmin(false);
  };

  const handleDropdownToggle = () => {
    setShowNotesDropdown((previous) => !previous);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim()) {
      toast.error('Add a note before saving');
      return;
    }

    const emailTargets: ('agent' | 'mc' | 'admin')[] = [];
    if (emailAgent && hasAgentEmail && !hiddenFromAgent) {
      emailTargets.push('agent');
    }
    if (emailMc && hasMcEmail && !hiddenFromMc) {
      emailTargets.push('mc');
    }
    if (emailAdmin && hasAdminEmails) {
      emailTargets.push('admin');
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content: content.trim(),
          hiddenFromAgent: canControlVisibility ? hiddenFromAgent : undefined,
          hiddenFromMc: canControlVisibility ? hiddenFromMc : undefined,
          emailTargets: emailTargets.length > 0 ? emailTargets : undefined
        })
      });
      if (!response.ok) {
        throw new Error('Unable to save note');
      }
      const created = (await response.json()) as ReferralNoteResponse;
      const { deliveryFailed, deliveryFailureReason, ...notePayload } = created;
      setNotes((previous) => [
        {
          ...notePayload,
          createdAt:
            typeof notePayload.createdAt === 'string'
              ? notePayload.createdAt
              : new Date(notePayload.createdAt).toISOString()
        },
        ...previous
      ]);
      resetForm();
      void mutate(activityFeedKey);

      const emailSummary =
        Array.isArray(notePayload.emailedTargets) && notePayload.emailedTargets.length > 0
          ? ` Email sent to ${notePayload.emailedTargets
              .map((target) => {
                if (target === 'agent') {
                  return agentContact?.name || 'agent';
                }
                if (target === 'mc') {
                  return mcContact?.name || 'MC';
                }
                return 'admins';
              })
              .join(' & ')}.`
          : '';
      toast.success(`Note added.${emailSummary}`.trim());

      if (deliveryFailed && emailTargets.length > 0) {
        const message = (() => {
          switch (deliveryFailureReason) {
            case 'missing_configuration':
              return 'Note saved, but email delivery is disabled. Set RESEND_API_KEY and EMAIL_FROM environment variables to enable email notifications.';
            case 'no_recipients':
              return 'Note saved, but no recipients with valid email addresses were available.';
            default:
              return 'Note was saved, but the email could not be delivered.';
          }
        })();
        toast.error(message);
      }
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Notes</h2>
        <p className="text-sm text-slate-500">Capture context and decisions for this referral</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none"
          placeholder="Add a note with borrower updates or next steps"
          disabled={saving}
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {canControlVisibility && (
            <ToggleControl
              label="Hide from agent"
              checked={hiddenFromAgent}
              onChange={(value) => setHiddenFromAgent(value)}
              disabled={saving}
            />
          )}
          {canControlVisibility && (
            <ToggleControl
              label="Hide from MC"
              checked={hiddenFromMc}
              onChange={(value) => setHiddenFromMc(value)}
              disabled={saving}
            />
          )}
          <ToggleControl
            label={viewerRole === 'agent' ? 'Email myself this note' : 'Email agent'}
            checked={emailAgent}
            onChange={(value) => setEmailAgent(value)}
            disabled={agentEmailDisabled}
          />
          <ToggleControl
            label="Email MC"
            checked={emailMc}
            onChange={(value) => setEmailMc(value)}
            disabled={mcEmailDisabled}
          />
          <ToggleControl
            label="Email admin"
            checked={emailAdmin}
            onChange={(value) => setEmailAdmin(value)}
            disabled={adminEmailDisabled}
          />
        </div>
        {(() => {
          const missingMessages: string[] = [];
          if (!hasAgentEmail) {
            missingMessages.push('Assign an agent with an email address to notify them automatically.');
          }
          if (!hasMcEmail) {
            missingMessages.push('Assign an MC with an email address to notify them automatically.');
          }
          if (!hasAdminEmails) {
            missingMessages.push('Add an admin user with an email address to notify them automatically.');
          }
          return missingMessages.length > 0 ? (
            <ul className="space-y-1 text-xs text-slate-400">
              {missingMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null;
        })()}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving || !content.trim()}
            className="inline-flex items-center rounded bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={resetForm}
            className="inline-flex items-center rounded border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
          >
            Cancel
          </button>
        </div>
      </form>
      <div>
        {sortedNotes.length === 0 ? (
          <p className="text-sm text-slate-500">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleDropdownToggle}
              className="flex w-full items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
            >
              <span>
                Show details ({sortedNotes.length})
              </span>
              <span className={`transition-transform ${showNotesDropdown ? 'rotate-180' : ''}`} aria-hidden>
                ▾
              </span>
            </button>
            {showNotesDropdown && (
              <div className="max-h-80 space-y-2 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                {sortedNotes.map((note) => {
                  const showVisibilityBadge =
                    viewerRole === 'admin' && (note.hiddenFromAgent || note.hiddenFromMc);
                  const showEmailBadge =
                    Array.isArray(note.emailedTargets) && note.emailedTargets.length > 0;
                  const showBadges = showVisibilityBadge || showEmailBadge;

                  return (
                    <div key={note.id} className="rounded border border-slate-200 bg-white px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs font-semibold text-slate-600">
                        <span className="truncate">
                          {note.authorName} · {note.authorRole}
                        </span>
                        <span className="text-slate-400">{formatTimestamp(note.createdAt)}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{note.content}</p>
                      {showBadges && (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
                          {showVisibilityBadge && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                              {[
                                note.hiddenFromAgent ? 'Hidden from agent' : null,
                                note.hiddenFromMc ? 'Hidden from MC' : null
                              ]
                                .filter(Boolean)
                                .join(' • ')}
                            </span>
                          )}
                          {showEmailBadge && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                              {`Emailed: ${note.emailedTargets
                                ?.map((target) => {
                                  if (target === 'agent') {
                                    return 'Agent';
                                  }
                                  if (target === 'mc') {
                                    return 'MC';
                                  }
                                  return 'Admin';
                                })
                                .join(' & ')}`}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
