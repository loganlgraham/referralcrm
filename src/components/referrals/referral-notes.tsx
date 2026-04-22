'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { Trash2, Pencil } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import { shouldDefaultEmailMcForAgentNotes } from '@/utils/referral-email-defaults';

interface StoredReferralNote {
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

interface ReferralNoteResponse extends StoredReferralNote {
  deliveryFailed?: boolean;
  deliveryFailureReason?: DeliveryFailureReason;
}

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;

interface Props {
  referralId: string;
  initialNotes: StoredReferralNote[];
  viewerRole: ViewerRole;
  agentContact?: { name?: string | null; email?: string | null } | null;
  mcContact?: { name?: string | null; email?: string | null } | null;
  adminContacts?: { name?: string | null; email?: string | null }[];
  hasAnyPayments?: boolean;
  hasAnyUsedAfcTrue?: boolean;
}

const formatTimestamp = (value: string) => {
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy 'at' h:mm a 'MT'");
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
    disabled ? 'bg-surface-subtle' : checked ? 'bg-primary-600' : 'bg-surface-subtle'
  }`;

  const thumbClasses = `inline-block h-4 w-4 transform rounded-full bg-surface-raised shadow transition ${
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
      className={`inline-flex items-center gap-2 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
        disabled ? 'cursor-not-allowed text-foreground-subtle' : 'cursor-pointer text-foreground-muted'
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
  hasAnyPayments = false,
  hasAnyUsedAfcTrue = false,
}: Props) {
  const [notes, setNotes] = useState<StoredReferralNote[]>(() => [...initialNotes]);
  const [content, setContent] = useState('');
  const [hiddenFromAgent, setHiddenFromAgent] = useState(false);
  const [hiddenFromMc, setHiddenFromMc] = useState(false);
  const [emailAgent, setEmailAgent] = useState(false);
  const [emailAdmin, setEmailAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNotesDropdown, setShowNotesDropdown] = useState(false);
  const [deletingNotes, setDeletingNotes] = useState<Set<string>>(new Set());
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editHiddenFromAgent, setEditHiddenFromAgent] = useState(false);
  const [editHiddenFromMc, setEditHiddenFromMc] = useState(false);
  const [editingNotes, setEditingNotes] = useState<Set<string>>(new Set());
  const { mutate } = useSWRConfig();

  const activityFeedKey = `/api/referrals/${referralId}/activities`;

  const canControlVisibility = viewerRole === 'admin' || viewerRole === 'manager';
  const hasAgentEmail = Boolean(agentContact?.email);
  const hasMcEmail = Boolean(mcContact?.email);
  const shouldDefaultEmailMc =
    viewerRole === 'agent' &&
    hasMcEmail &&
    shouldDefaultEmailMcForAgentNotes({
      hasAnyPayments,
      hasAnyUsedAfcTrue
    });
  const [emailMc, setEmailMc] = useState(() => shouldDefaultEmailMc);
  const hasAdminEmails = Array.isArray(adminContacts)
    ? adminContacts.some((contact) => contact?.email)
    : false;
  const agentEmailDisabled = saving || hiddenFromAgent || !hasAgentEmail;
  const mcEmailDisabled = saving || hiddenFromMc || !hasMcEmail;
  const adminEmailDisabled = saving || !hasAdminEmails;

  useEffect(() => {
    setNotes([...initialNotes]);
  }, [initialNotes]);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notes]
  );

  const previewNotes = useMemo(() => sortedNotes.slice(0, 2), [sortedNotes]);

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
    setEmailMc(shouldDefaultEmailMc);
    setEmailAdmin(false);
  };

  const handleDropdownToggle = () => {
    setShowNotesDropdown((previous) => !previous);
  };

  const handleDelete = async (noteId: string) => {
    setDeletingNotes((previous) => new Set(previous).add(noteId));
    try {
      const response = await fetch(`/api/referrals/${referralId}/notes/${noteId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Unable to delete note');
      }
      setNotes((previous) => previous.filter((note) => note.id !== noteId));
      void mutate(activityFeedKey);
      toast.success('Note deleted');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to delete note');
    } finally {
      setDeletingNotes((previous) => {
        const next = new Set(previous);
        next.delete(noteId);
        return next;
      });
    }
  };

  const handleEditStart = (note: StoredReferralNote) => {
    setEditingNoteId(note.id);
    setEditContent(note.content);
    setEditHiddenFromAgent(note.hiddenFromAgent || false);
    setEditHiddenFromMc(note.hiddenFromMc || false);
  };

  const handleEditCancel = () => {
    setEditingNoteId(null);
    setEditContent('');
    setEditHiddenFromAgent(false);
    setEditHiddenFromMc(false);
  };

  const handleEditSave = async (noteId: string) => {
    if (!editContent.trim()) {
      toast.error('Note content cannot be empty');
      return;
    }

    setEditingNotes((previous) => new Set(previous).add(noteId));
    try {
      const response = await fetch(`/api/referrals/${referralId}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content: editContent.trim(),
          hiddenFromAgent: canControlVisibility ? editHiddenFromAgent : undefined,
          hiddenFromMc: canControlVisibility ? editHiddenFromMc : undefined
        })
      });
      if (!response.ok) {
        throw new Error('Unable to update note');
      }
      const updated = (await response.json()) as StoredReferralNote;
      setNotes((previous) =>
        previous.map((note) =>
          note.id === noteId
            ? {
                ...updated,
                createdAt:
                  typeof updated.createdAt === 'string'
                    ? updated.createdAt
                    : new Date(updated.createdAt).toISOString()
              }
            : note
        )
      );
      handleEditCancel();
      void mutate(activityFeedKey);
      toast.success('Note updated');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update note');
    } finally {
      setEditingNotes((previous) => {
        const next = new Set(previous);
        next.delete(noteId);
        return next;
      });
    }
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

  const renderNoteCard = (note: StoredReferralNote) => {
    const showVisibilityBadge = viewerRole === 'admin' && (note.hiddenFromAgent || note.hiddenFromMc);
    const showEmailBadge = Array.isArray(note.emailedTargets) && note.emailedTargets.length > 0;
    const showBadges = showVisibilityBadge || showEmailBadge;
    const canDelete = canControlVisibility;
    const isDeleting = deletingNotes.has(note.id);
    const isEditing = editingNoteId === note.id;
    const isEditingNote = editingNotes.has(note.id);

    return (
      <div key={note.id} className="rounded border border-border bg-surface-raised px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs font-semibold text-foreground-muted">
          <span className="truncate">
            {note.authorName} · {note.authorRole}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-foreground-subtle">{formatTimestamp(note.createdAt)}</span>
            {!isEditing && (
              <>
                <button
                  type="button"
                  onClick={() => handleEditStart(note)}
                  className="inline-flex items-center rounded p-1 text-foreground-subtle transition hover:text-primary-700 hover:bg-primary-700/10"
                  aria-label="Edit note"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => handleDelete(note.id)}
                    disabled={isDeleting}
                    className="inline-flex items-center rounded p-1 text-foreground-subtle transition hover:text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {isEditing ? (
          <div className="mt-2 space-y-3">
            <textarea
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              rows={3}
              className="w-full rounded border border-border px-3 py-2 text-sm text-foreground-muted focus:border-primary-500 focus:outline-none"
              placeholder="Edit note content"
              disabled={isEditingNote}
            />
            {canControlVisibility && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <ToggleControl
                  label="Hide from agent"
                  checked={editHiddenFromAgent}
                  onChange={(value) => setEditHiddenFromAgent(value)}
                  disabled={isEditingNote}
                />
                <ToggleControl
                  label="Hide from MC"
                  checked={editHiddenFromMc}
                  onChange={(value) => setEditHiddenFromMc(value)}
                  disabled={isEditingNote}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleEditSave(note.id)}
                disabled={isEditingNote || !editContent.trim()}
                className="inline-flex items-center rounded bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isEditingNote ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleEditCancel}
                disabled={isEditingNote}
                className="inline-flex items-center rounded border border-border px-3 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-70"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-2 whitespace-pre-line text-sm text-foreground-muted">{note.content}</p>
            {showBadges && (
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
                {showVisibilityBadge && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                    {[note.hiddenFromAgent ? 'Hidden from agent' : null, note.hiddenFromMc ? 'Hidden from MC' : null]
                      .filter(Boolean)
                      .join(' • ')}
                  </span>
                )}
                {showEmailBadge && (
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-foreground-muted">
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
          </>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-raised p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Notes</h2>
        <p className="text-sm text-foreground-subtle">Capture context and decisions for this referral</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          className="w-full rounded border border-border px-3 py-2 text-sm text-foreground-muted focus:border-primary-500 focus:outline-none"
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
            <ul className="space-y-1 text-xs text-foreground-subtle">
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
            className="inline-flex items-center rounded bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? 'Saving…' : 'Save note'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={resetForm}
            className="inline-flex items-center rounded border border-border px-3 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-70"
          >
            Cancel
          </button>
        </div>
      </form>
      <div>
        {sortedNotes.length === 0 ? (
          <p className="text-sm text-foreground-subtle">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            {!showNotesDropdown && (
              <div className="space-y-2">
                {previewNotes.map(renderNoteCard)}
              </div>
            )}
            {sortedNotes.length > 2 && (
              <button
                type="button"
                onClick={handleDropdownToggle}
                className="flex w-full items-center justify-between rounded border border-border bg-surface-muted px-3 py-2 text-left text-sm font-semibold text-foreground-muted transition hover:bg-surface-subtle"
              >
                <span>
                  {showNotesDropdown ? 'Hide note drawer' : `Show all notes (${sortedNotes.length})`}
                </span>
                <span className={`transition-transform ${showNotesDropdown ? 'rotate-180' : ''}`} aria-hidden>
                  ▾
                </span>
              </button>
            )}
            {showNotesDropdown && (
              <div className="max-h-80 space-y-2 overflow-y-auto rounded border border-border bg-surface-muted p-2">
                {sortedNotes.map(renderNoteCard)}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
