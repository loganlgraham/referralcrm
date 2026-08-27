'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import { formatInTimeZone } from 'date-fns-tz';
import { cn } from '@/lib/cn';
import { fetcher } from '@/utils/fetcher';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';
import { shouldDefaultEmailMcForAgentNotes } from '@/utils/referral-email-defaults';
import { Button } from '@/components/ui/button';

export interface AgentActivityNote {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
}

interface TimelineActivity {
  _id: string;
  actor: string;
  actorName?: string | null;
  channel: string;
  content: string;
  createdAt: string;
}

interface AgentActivityCardProps {
  referralId: string;
  notes: AgentActivityNote[];
  agentContact?: { name?: string | null; email?: string | null } | null;
  mcContact?: { name?: string | null; email?: string | null } | null;
  adminContacts?: { name?: string | null; email?: string | null }[];
  hasAnyPayments?: boolean;
  hasAnyUsedAfcTrue?: boolean;
}

type EmailTarget = 'agent' | 'mc' | 'admin';

interface StreamEntry {
  id: string;
  kind: 'note' | 'status';
  body: string;
  emphasis?: string;
  meta: string;
  at: number;
}

const formatStamp = (value: string, withTime: boolean): string => {
  try {
    return formatInTimeZone(
      new Date(value),
      SLA_TIME_ZONE,
      withTime ? "MMM d, yyyy 'at' h:mm a 'MT'" : 'MMM d, yyyy'
    );
  } catch {
    return value;
  }
};

/** Status changes surface as `Status changed to X` on the shared activity feed. */
const STATUS_CHANGE_PREFIX = /^status\s+(changed|moved|updated)\s+to\s+/i;

export function AgentActivityCard({
  referralId,
  notes,
  agentContact,
  mcContact,
  adminContacts,
  hasAnyPayments = false,
  hasAnyUsedAfcTrue = false
}: AgentActivityCardProps) {
  const { mutate } = useSWRConfig();
  const activityFeedKey = `/api/referrals/${referralId}/activities`;
  const { data: timeline } = useSWR<TimelineActivity[]>(activityFeedKey, fetcher, {
    refreshInterval: 60_000
  });

  const hasAgentEmail = Boolean(agentContact?.email);
  const hasMcEmail = Boolean(mcContact?.email);
  const hasAdminEmails = Array.isArray(adminContacts)
    ? adminContacts.some((contact) => contact?.email)
    : false;
  const defaultEmailMc = shouldDefaultEmailMcForAgentNotes({
    viewerRole: 'agent',
    hasMcEmail,
    hasAnyPayments,
    hasAnyUsedAfcTrue
  });

  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailMc, setEmailMc] = useState(defaultEmailMc);
  const [emailAdmin, setEmailAdmin] = useState(false);
  const [emailSelf, setEmailSelf] = useState(false);
  const [localNotes, setLocalNotes] = useState(notes);

  useEffect(() => {
    setLocalNotes(notes);
  }, [notes]);

  const stream = useMemo<StreamEntry[]>(() => {
    const entries: StreamEntry[] = localNotes.map((note) => ({
      id: `note-${note.id}`,
      kind: 'note',
      body: note.content,
      meta: `${note.authorName} · ${note.authorRole} · ${formatStamp(note.createdAt, true)}`,
      at: new Date(note.createdAt).getTime()
    }));

    for (const activity of timeline ?? []) {
      const match = STATUS_CHANGE_PREFIX.exec(activity.content);
      if (!match) {
        continue;
      }
      entries.push({
        id: `status-${activity._id}`,
        kind: 'status',
        body: 'Status moved to ',
        emphasis: activity.content.slice(match[0].length).trim(),
        meta: `${activity.actorName?.trim() || activity.actor} · ${formatStamp(activity.createdAt, false)}`,
        at: new Date(activity.createdAt).getTime()
      });
    }

    return entries.sort((a, b) => b.at - a.at);
  }, [localNotes, timeline]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error('Add a note before saving');
      return;
    }

    const emailTargets: EmailTarget[] = [];
    if (emailMc && hasMcEmail) {
      emailTargets.push('mc');
    }
    if (emailAdmin && hasAdminEmails) {
      emailTargets.push('admin');
    }
    if (emailSelf && hasAgentEmail) {
      emailTargets.push('agent');
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content: trimmed,
          emailTargets: emailTargets.length > 0 ? emailTargets : undefined
        })
      });

      if (!response.ok) {
        throw new Error('Unable to save note');
      }

      const saved = (await response.json()) as AgentActivityNote;
      setLocalNotes((current) => [saved, ...current]);
      setContent('');
      setEmailMc(defaultEmailMc);
      setEmailAdmin(false);
      setEmailSelf(false);
      void mutate(activityFeedKey);
      toast.success('Note added.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-card border border-border bg-surface shadow-resting">
      <div className="px-5 pt-[18px]">
        <h2 className="text-base font-bold tracking-[-0.02em] text-foreground">Activity</h2>
        <p className="mt-1 text-[13px] text-foreground-subtle">Notes and status changes, newest first.</p>

        <form onSubmit={handleSubmit}>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Add a note with borrower updates or next steps"
            className="mt-3.5 min-h-[72px] w-full resize-none rounded-lg border border-border-strong/70 bg-surface px-3 py-2.5 text-sm leading-normal text-foreground shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)] focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-2.5 flex flex-wrap items-center gap-2 pb-[18px]">
            <span className="text-[13px] text-foreground-subtle">Notify</span>
            <NotifyChip
              label={mcContact?.name || 'MC'}
              active={emailMc}
              disabled={saving || !hasMcEmail}
              onToggle={() => setEmailMc((current) => !current)}
            />
            <NotifyChip
              label="Admin"
              active={emailAdmin}
              disabled={saving || !hasAdminEmails}
              onToggle={() => setEmailAdmin((current) => !current)}
            />
            <NotifyChip
              label="Me"
              active={emailSelf}
              disabled={saving || !hasAgentEmail}
              onToggle={() => setEmailSelf((current) => !current)}
            />
            <span className="flex-1" />
            <Button type="submit" className="h-[38px]" loading={saving} disabled={!content.trim()}>
              Save note
            </Button>
          </div>
        </form>
      </div>

      {stream.length > 0 ? (
        <div className="flex flex-col gap-3.5 border-t border-border px-5 pb-[18px] pt-4">
          {stream.map((entry) => (
            <div key={entry.id} className="flex gap-3">
              <span
                aria-hidden
                className={cn(
                  'mt-[5px] h-[9px] w-[9px] shrink-0 rounded-pill',
                  entry.kind === 'status' ? 'bg-warning' : 'bg-border-strong'
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-[1.45] text-foreground">
                  {entry.body}
                  {entry.emphasis ? <span className="font-bold">{entry.emphasis}</span> : null}
                </p>
                <p className="mt-[3px] text-[13px] text-foreground-subtle">{entry.meta}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="border-t border-border px-5 py-5 text-[13px] text-foreground-subtle">
          Nothing logged yet. Add a note or move the status to start the record.
        </p>
      )}
    </section>
  );
}

function NotifyChip({
  label,
  active,
  disabled,
  onToggle
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'inline-flex h-[30px] items-center rounded-pill px-[11px] text-xs transition disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'bg-primary font-semibold text-white'
          : 'border border-border bg-surface font-medium text-foreground-muted hover:bg-surface-muted'
      )}
    >
      {label}
    </button>
  );
}
