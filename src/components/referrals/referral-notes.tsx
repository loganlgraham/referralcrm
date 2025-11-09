'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

interface ReferralNote {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  hiddenFromAgent?: boolean;
  hiddenFromMc?: boolean;
  emailedTargets?: ('agent' | 'mc')[];
}

type ViewerRole = 'admin' | 'manager' | 'agent' | 'mc' | 'viewer' | string;

interface Props {
  referralId: string;
  initialNotes: ReferralNote[];
  viewerRole: ViewerRole;
  agentContact?: { name?: string | null; email?: string | null } | null;
  mcContact?: { name?: string | null; email?: string | null } | null;
}

const formatTimestamp = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch (error) {
    return value;
  }
};

export function ReferralNotes({
  referralId,
  initialNotes,
  viewerRole,
  agentContact,
  mcContact
}: Props) {
  const [notes, setNotes] = useState<ReferralNote[]>(() => [...initialNotes]);
  const [content, setContent] = useState('');
  const [hiddenFromAgent, setHiddenFromAgent] = useState(false);
  const [hiddenFromMc, setHiddenFromMc] = useState(false);
  const [emailAgent, setEmailAgent] = useState(false);
  const [emailMc, setEmailMc] = useState(false);
  const [saving, setSaving] = useState(false);

  const canControlVisibility = viewerRole === 'admin' || viewerRole === 'manager';
  const hasAgentEmail = Boolean(agentContact?.email);
  const hasMcEmail = Boolean(mcContact?.email);
  const canEmailNote = hasAgentEmail || hasMcEmail;

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

  const resetForm = () => {
    setContent('');
    setHiddenFromAgent(false);
    setHiddenFromMc(false);
    setEmailAgent(false);
    setEmailMc(false);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim()) {
      toast.error('Add a note before saving');
      return;
    }

    const emailTargets: ('agent' | 'mc')[] = [];
    if (emailAgent && hasAgentEmail && !hiddenFromAgent) {
      emailTargets.push('agent');
    }
    if (emailMc && hasMcEmail && !hiddenFromMc) {
      emailTargets.push('mc');
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const created = (await response.json()) as ReferralNote;
      setNotes((previous) => [
        {
          ...created,
          createdAt:
            typeof created.createdAt === 'string'
              ? created.createdAt
              : new Date(created.createdAt).toISOString()
        },
        ...previous
      ]);
      resetForm();
      const emailSummary = Array.isArray(created.emailedTargets) && created.emailedTargets.length > 0
        ? ` Email sent to ${created.emailedTargets
            .map((target) => (target === 'agent' ? agentContact?.name || 'agent' : mcContact?.name || 'MC'))
            .join(' & ')}.`
        : '';
      toast.success(`Note added.${emailSummary}`.trim());
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
        {canControlVisibility && (
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={hiddenFromAgent}
                onChange={(event) => setHiddenFromAgent(event.target.checked)}
                disabled={saving}
              />
              Hide from agent
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={hiddenFromMc}
                onChange={(event) => setHiddenFromMc(event.target.checked)}
                disabled={saving}
              />
              Hide from MC
            </label>
          </div>
        )}
        {canEmailNote && (
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            {hasAgentEmail && (
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={emailAgent}
                  onChange={(event) => setEmailAgent(event.target.checked)}
                  disabled={saving || hiddenFromAgent}
                />
                Email agent
              </label>
            )}
            {hasMcEmail && (
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={emailMc}
                  onChange={(event) => setEmailMc(event.target.checked)}
                  disabled={saving || hiddenFromMc}
                />
                Email MC
              </label>
            )}
            {(!hasAgentEmail || !hasMcEmail) && (
              <span className="text-slate-400">
                {hasAgentEmail && !hasMcEmail
                  ? 'MC email unavailable'
                  : !hasAgentEmail && hasMcEmail
                    ? 'Agent email unavailable'
                    : 'No email contacts available'}
              </span>
            )}
          </div>
        )}
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
      <div className="space-y-3">
        {sortedNotes.length === 0 && <p className="text-sm text-slate-500">No notes yet.</p>}
        {sortedNotes.map((note) => (
          <div key={note.id} className="rounded border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">
                {note.authorName} · {note.authorRole}
              </span>
              <span>{formatTimestamp(note.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{note.content}</p>
            {(note.hiddenFromAgent || note.hiddenFromMc) && viewerRole === 'admin' && (
              <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                {[
                  note.hiddenFromAgent ? 'Hidden from agent' : null,
                  note.hiddenFromMc ? 'Hidden from MC' : null
                ]
                  .filter(Boolean)
                  .join(' • ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
