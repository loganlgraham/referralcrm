'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui/button';
import type { FubEnrollment, ReferralAutomationList } from '@/lib/fub/automations';

export function ReferralAutomations({ referralId, personId, borrowerName }: {
  referralId: string; personId: number; borrowerName?: string;
}) {
  const url = '/api/referrals/' + referralId + '/automations';
  const [data, setData] = useState<ReferralAutomationList | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [choiceId, setChoiceId] = useState('');
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const list = await res.json();
      if (!res.ok || list.personId !== personId || !Array.isArray(list.enrollments) || !Array.isArray(list.choices)) throw new Error();
      if (current === generation.current) setData(list);
    } catch {
      if (current === generation.current) { setData(null); setError(true); }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [url, personId]);
  useEffect(() => {
    void load();
    return () => { generation.current++; };
  }, [load]);

  const selected = data?.choices.find(option => String(option.id) === choiceId);
  async function start() {
    if (!data?.canStart || !selected || busy.current) return;
    busy.current = true;
    setStarting(true);
    setNotice('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedPersonId: personId, automationId: selected.id, previousId: selected.previousId }),
      });
      const result = await res.json().catch(() => null);
      if (!res.ok || !result?.enrollment?.id) throw new Error(result?.error || 'FUB did not confirm the start. Check the customer in Follow Up Boss.');
      setNotice('Started ' + selected.name + '.' + (result.auditIncomplete ? ' The local activity record may be incomplete.' : ''));
    } catch (cause) {
      setNotice(cause instanceof TypeError ? 'FUB did not confirm the start. Check the customer in Follow Up Boss.' :
        cause instanceof Error ? cause.message : 'Could not confirm the start.');
    } finally {
      setSelecting(false);
      setChoiceId('');
      await load();
      busy.current = false;
      setStarting(false);
    }
  }

  const active = data?.enrollments.filter(run => run.status !== 'Completed') ?? [];
  const completed = data?.enrollments.filter(run => run.status === 'Completed') ?? [];
  const secondary = buttonClasses({ variant: 'secondary', size: 'sm' });
  return (
    <div className="mt-4 grid gap-2 border-t border-border pt-3 text-sm" aria-label="FUB automations">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">FUB automations</h3>
        <button type="button" className={secondary} disabled={loading || starting} onClick={() => void load()}>Refresh automations</button>
      </div>
      {loading && !data && <p>Loading automations…</p>}
      {error && <p role="status">Couldn’t load automations for this contact.</p>}
      {data && <>
        {active.length ? <Runs items={active} /> : <p>No active automations for this contact.</p>}
        {completed.length > 0 && <details>
          <summary>Completed ({completed.length})</summary>
          <Runs items={completed} />
        </details>}
        {data.isAdmin && !selecting && (data.choices.length ? (
          <button type="button" className={secondary + ' justify-self-start'} disabled={starting || loading} onClick={() => { setSelecting(true); setNotice(''); }}>
            Start FUB automation
          </button>
        ) : <p>No automations are available to start for this contact.</p>)}
        {selecting && data.isAdmin && <div className="grid gap-2">
          <label className="grid gap-1">Automation
            <select className="min-w-0 rounded-md border border-border bg-surface px-2 py-2" value={choiceId}
              disabled={starting} onChange={event => setChoiceId(event.target.value)}>
              <option value="">Choose an automation</option>
              {data.choices.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>
          {selected && <p>Start <strong>{selected.name}</strong> for {borrowerName || 'this borrower'} (FUB contact {personId})?</p>}
          {!data.canStart && <p>Live starts are available in production. This preview is read-only.</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClasses({ variant: 'primary', size: 'sm' })} disabled={!data.canStart || !selected || starting || loading}
              onClick={() => void start()}>{starting ? 'Starting…' : 'Confirm start'}</button>
            <button type="button" className={secondary} disabled={starting} onClick={() => { setSelecting(false); setChoiceId(''); }}>Cancel</button>
          </div>
        </div>}
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

function Runs({ items }: { items: FubEnrollment[] }) {
  return <ul className="grid gap-1 py-1">
    {items.map(run => <li key={run.id} className="flex justify-between gap-3">
      <span className="min-w-0 break-words">{run.name}</span>
      <span className="shrink-0 text-foreground-muted">{run.status === 'Initial' ? 'Queued' : run.status}</span>
    </li>)}
  </ul>;
}
