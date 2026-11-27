'use client';

import { useState, type FormEvent } from 'react';
import { buttonClasses } from '@/components/ui/button';
import type { SopAudit } from '@/lib/intelligence/sop-contract';
import type { Day31Decision, Day31DecisionRecord } from '@/lib/intelligence/sop-decisions';

const decisionTime = (value: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

export function FubDay31Decision({ review, record, onSaved }: {
  review: SopAudit;
  record?: Day31DecisionRecord;
  onSaved: (record: Day31DecisionRecord) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<Day31Decision | ''>('');
  const [reason, setReason] = useState('');
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const start = () => {
    setEditing(true);
    setDecision(record?.decision ?? '');
    setReason(record?.reason ?? '');
    setExpectedRevision(record?.revision ?? 0);
    setRequestId(null);
    setError('');
    setSuccess(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!decision || !reason.trim() || saving) return;
    const id = requestId ?? crypto.randomUUID();
    setRequestId(id);
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/dashboard/fub/decisions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: review.personId, reviewId: review.id, decision, reason: reason.trim(), expectedRevision, requestId: id }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setError('This review changed while you were editing. Close and reopen it after refreshing the dashboard.');
        } else setError(typeof body.error === 'string' ? body.error : 'The decision could not be saved. Try again.');
        return;
      }
      if (!body.record || body.record.personId !== review.personId || body.record.reviewId !== review.id) {
        setError('The decision response could not be confirmed. Refresh before trying again.');
        return;
      }
      onSaved(body.record as Day31DecisionRecord);
      setEditing(false);
      setSuccess(true);
    } catch {
      setError('The save could not be confirmed. Retry with the same decision to avoid creating a duplicate.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-subtle p-3">
      {record ? (
        <>
          <p className="text-sm font-semibold">Decision: {record.decision === 'keep' ? 'Keep' : 'Release'}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{record.reason}</p>
          <p className="mt-1 text-xs text-foreground-muted">Recorded by {record.reviewerName} · {decisionTime(record.decidedAt)} MT</p>
          <details className="mt-2 text-xs text-foreground-muted">
            <summary className="cursor-pointer">Decision history ({record.history.length})</summary>
            <ol className="mt-2 space-y-2">
              {[...record.history].reverse().map((revision) => (
                <li key={revision.revision}>
                  <strong>{revision.decision === 'keep' ? 'Keep' : 'Release'}</strong> · {revision.reviewerName} · {decisionTime(revision.decidedAt)} MT
                  <p className="whitespace-pre-wrap break-words">{revision.reason}</p>
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : <p className="text-sm font-semibold">Explicit decision needed</p>}
      {success ? <p role="status" className="mt-2 text-sm text-success">Decision recorded.</p> : null}
      {!editing ? (
        <button className={`${buttonClasses({ variant: 'secondary', size: 'sm' })} mt-3`} onClick={start}>
          {record ? 'Change decision' : 'Record decision'}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <label className="block text-sm font-medium" htmlFor={`decision-${review.id}`}>Day 31 decision</label>
          <select id={`decision-${review.id}`} value={decision} disabled={saving} required
            onChange={(event) => { setDecision(event.target.value as Day31Decision | ''); setRequestId(null); }}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <option value="">Choose Keep or Release</option>
            <option value="keep">Keep</option><option value="release">Release</option>
          </select>
          <label className="block text-sm font-medium" htmlFor={`reason-${review.id}`}>Reason for this decision</label>
          <textarea id={`reason-${review.id}`} value={reason} disabled={saving} required maxLength={2000} rows={3}
            onChange={(event) => { setReason(event.target.value); setRequestId(null); }}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
          <p className="text-xs text-foreground-muted">This records the review in Referrio. Make any assignment, stage, or follow-up changes in FUB.</p>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving || !decision || !reason.trim()} className={buttonClasses({ size: 'sm' })}>
              {saving ? 'Saving…' : 'Save decision'}
            </button>
            <button type="button" disabled={saving} onClick={() => setEditing(false)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
