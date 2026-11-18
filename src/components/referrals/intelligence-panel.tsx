'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { buttonClasses } from '@/components/ui/button';
import { railCardClasses, railTitleClasses } from '@/components/referrals/referral-rail';

type PanelPayload = {
  state: 'unlinked' | 'ready' | 'incomplete' | 'unavailable' | 'no_records' | 'linked';
  reason?: string;
  referrioAgent?: string | null;
  fubAssignedUser?: { id: number; name: string } | null;
  agentsDiffer?: boolean;
  latest?: { channel: string; direction: string; displayTime: string } | null;
  followUp?: { status: string; nextAction: string; detail: string } | null;
  projectedClosings?: { display: string; dateOnly: boolean; stage: string | null; projection: true }[];
  freshness?: { readAt: string; note: string };
  officialScoring?: false;
};

export function IntelligencePanel({ referralId }: { referralId: string }) {
  const [payload, setPayload] = useState<PanelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [personId, setPersonId] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/intelligence`, { cache: 'no-store' });
      const body = await response.json() as PanelPayload;
      setPayload(body);
    } catch {
      setPayload({ state: 'unavailable', reason: 'timeout', officialScoring: false });
    } finally {
      setLoading(false);
    }
  }, [referralId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch(`/api/referrals/${referralId}/intelligence`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantKey: 'borrower', personId: personId.trim() }),
    });
    if (!response.ok) {
      setMessage('That person id was not saved.');
      return;
    }
    setPersonId('');
    await load();
  }

  async function clearLink() {
    setMessage(null);
    await fetch(`/api/referrals/${referralId}/intelligence`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participantKey: 'borrower', personId: null }),
    });
    setPersonId('');
    await load();
  }

  return (
    <section className={railCardClasses} aria-labelledby="intelligence-panel-title">
      <h2 id="intelligence-panel-title" className={railTitleClasses}>Customer communication</h2>
      <p className="mt-1 text-sm text-foreground-muted">Stored Follow Up Boss activity for the linked customer. This is not a score.</p>
      {loading ? <p className="mt-4 text-sm">Loading stored activity…</p> : <PanelBody payload={payload} />}
      <form className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" onSubmit={save}>
        <label className="grid gap-1 text-sm">
          Follow Up Boss person id
          <input
            className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
            inputMode="numeric"
            autoComplete="off"
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            aria-describedby="intelligence-person-help"
          />
        </label>
        <button className={buttonClasses({ variant: 'primary', size: 'md' })} type="submit">Save link</button>
        <button className={buttonClasses({ variant: 'secondary', size: 'md' })} type="button" onClick={() => void clearLink()}>Clear link</button>
      </form>
      <p id="intelligence-person-help" className="mt-2 text-xs text-foreground-muted">Enter the person id explicitly. A name, email, or phone number is not used to create the link.</p>
      {message ? <p className="mt-2 text-sm">{message}</p> : null}
    </section>
  );
}

function PanelBody({ payload }: { payload: PanelPayload | null }) {
  if (!payload) return <p className="mt-4 text-sm">Stored activity is unavailable. This is not no activity.</p>;
  if (payload.state === 'unlinked') {
    return <p className="mt-4 text-sm">This customer is not linked. No Follow Up Boss activity is shown.</p>;
  }
  if (payload.state === 'unavailable') {
    if (payload.reason === 'unmapped') return <p className="mt-4 text-sm">Intelligence access is not mapped for this login.</p>;
    if (payload.reason === 'revoked') return <p className="mt-4 text-sm">Intelligence access for this login was revoked.</p>;
    if (payload.reason === 'wrong_organization') return <p className="mt-4 text-sm">This referral is outside the mapped organization.</p>;
    if (payload.reason === 'wrong_account') return <p className="mt-4 text-sm">This referral is outside the mapped Follow Up Boss account.</p>;
    return <p className="mt-4 text-sm">Stored activity is unavailable. This is not no activity.</p>;
  }
  if (payload.state === 'no_records') {
    return <p className="mt-4 text-sm">No stored call, text, or email metadata matched this customer.</p>;
  }
  return (
    <div className="mt-4 grid gap-3 text-sm">
      {payload.state === 'incomplete' ? <p>Coverage is incomplete. This is not no activity.</p> : null}
      <p><span className="font-semibold">Latest communication. </span>{payload.latest ? `${label(payload.latest.channel)} ${payload.latest.direction}, ${payload.latest.displayTime}` : 'No occurrence time is stored.'}</p>
      <p><span className="font-semibold">Follow-up. </span>{payload.followUp?.nextAction ?? 'Current follow-up status is unknown.'}</p>
      <p><span className="font-semibold">Referral agent. </span>{payload.referrioAgent ?? 'No referral agent is assigned.'}</p>
      <p><span className="font-semibold">Follow Up Boss assigned agent. </span>{payload.fubAssignedUser ? `${payload.fubAssignedUser.name} (${payload.fubAssignedUser.id})` : 'No assigned agent is stored.'}</p>
      {payload.agentsDiffer ? <p>The referral agent and the Follow Up Boss assigned agent are not the same person.</p> : null}
      <div>
        <p className="font-semibold">Projected closing</p>
        {payload.projectedClosings && payload.projectedClosings.length > 0 ? (
          <ul className="mt-1 list-disc pl-5">
            {payload.projectedClosings.map((closing) => (
              <li key={`${closing.display}-${closing.stage ?? 'stage'}`}>{closing.display}{closing.stage ? `, ${closing.stage}` : ''}. Projection.</li>
            ))}
          </ul>
        ) : <p>No projected closing is stored.</p>}
      </div>
      <p className="text-foreground-muted">{payload.freshness?.note ?? 'Freshness is unknown.'}</p>
      <details>
        <summary>Technical details</summary>
        <p className="mt-2 text-foreground-muted">{payload.followUp?.detail ?? payload.freshness?.note}</p>
      </details>
    </div>
  );
}

function label(channel: string): string {
  switch (channel) {
    case 'call':
      return 'Call';
    case 'text':
      return 'Text';
    case 'email':
      return 'Email';
    default:
      return 'Communication';
  }
}
