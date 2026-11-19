'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui/button';
import { railCardClasses, railTitleClasses } from '@/components/referrals/referral-rail';
import type { PanelActivity, PanelLink, PanelResponse } from '@/lib/intelligence/panel-response';

export function IntelligencePanel({ referralId }: { referralId: string }) {
  const [access, setAccess] = useState<'loading' | 'allowed' | 'denied' | 'unavailable'>('loading');
  const [link, setLink] = useState<PanelLink | null>(null);
  const [activity, setActivity] = useState<PanelActivity>({ status: 'not_requested' });
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const loadGeneration = useRef(0);

  const apply = useCallback((body: PanelResponse) => {
    if (body.access === 'denied') {
      setAccess('denied');
      setLink(null);
      setActivity({ status: 'not_requested' });
      return;
    }
    setAccess('allowed');
    setLink(body.link);
    setActivity(body.activity);
    if (body.link) setEditing(false);
  }, []);

  const load = useCallback(async (retry = false) => {
    const generation = ++loadGeneration.current;
    try {
      const response = await fetch(`/api/referrals/${referralId}/intelligence${retry ? '?retry=1' : ''}`, { cache: 'no-store' });
      const body = await response.json() as PanelResponse;
      if (generation !== loadGeneration.current) return;
      apply(body);
    } catch {
      if (generation !== loadGeneration.current) return;
      setAccess((current) => current === 'loading' ? 'unavailable' : current);
      setActivity({ status: 'unavailable' });
    }
  }, [apply, referralId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/referrals/${referralId}/intelligence`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantKey: 'borrower', personId: draft.trim() }),
      });
      const body = await response.json().catch(() => null) as PanelResponse | null;
      if (body?.access === 'denied') {
        apply(body);
        return;
      }
      if (!response.ok || !body?.saved || !body.link?.personId) {
        setNotice("Couldn't save link.");
        return;
      }
      setLink(body.link);
      setActivity({ status: 'not_requested' });
      setEditing(false);
      setDraft('');
      await load();
    } catch {
      setNotice("Couldn't save link.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function removeLink() {
    if (busy.current || !link) return;
    busy.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/referrals/${referralId}/intelligence`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantKey: 'borrower', personId: null }),
      });
      const body = await response.json().catch(() => null) as PanelResponse | null;
      if (body?.access === 'denied') {
        apply(body);
        return;
      }
      if (!response.ok || !body?.saved) {
        setNotice("Couldn't remove link.");
        return;
      }
      setLink(null);
      setActivity({ status: 'not_requested' });
      setEditing(false);
      setDraft('');
    } catch {
      setNotice("Couldn't remove link.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const showForm = access === 'allowed' && activity.status !== 'unavailable' && (!link || editing);
  return (
    <section className={`${railCardClasses} min-w-0 max-w-full`} aria-labelledby="intelligence-panel-title">
      <h2 id="intelligence-panel-title" className={railTitleClasses}>Customer communication</h2>
      <p className="mt-1 text-sm text-foreground-muted">Stored Follow Up Boss activity for the linked customer.</p>
      <ActivityBody access={access} link={link} activity={activity} onRetry={() => void load(true)} />
      {link ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="mr-auto min-w-0 break-words text-sm">Linked to FUB contact {link.personId}</p>
          <button className={buttonClasses({ variant: 'secondary', size: 'md' })} type="button" disabled={saving} onClick={() => { setDraft(String(link.personId)); setEditing(true); setNotice(null); }}>Change</button>
          <button className={buttonClasses({ variant: 'secondary', size: 'md' })} type="button" disabled={saving} onClick={() => void removeLink()}>Remove</button>
        </div>
      ) : null}
      {showForm ? (
        <form className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={save}>
          <label className="grid gap-1 text-sm">
            Follow Up Boss person id
            <input
              className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
              inputMode="numeric"
              autoComplete="off"
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby="intelligence-person-help"
            />
          </label>
          <button className={buttonClasses({ variant: 'primary', size: 'md' })} type="submit" disabled={saving || !/^[1-9]\d*$/.test(draft.trim())}>
            {saving ? 'Saving…' : 'Save link'}
          </button>
        </form>
      ) : null}
      {showForm ? <p id="intelligence-person-help" className="mt-2 text-xs text-foreground-muted">Enter the person id. A name, email, or phone number is not used.</p> : null}
      {notice ? <p className="mt-2 text-sm" role="status">{notice}</p> : null}
    </section>
  );
}

function ActivityBody({
  access,
  link,
  activity,
  onRetry,
}: {
  access: 'loading' | 'allowed' | 'denied' | 'unavailable';
  link: PanelLink | null;
  activity: PanelActivity;
  onRetry: () => void;
}) {
  if (access === 'loading') return <p className="mt-4 text-sm">Loading…</p>;
  if (access === 'denied') return <p className="mt-4 text-sm">You don&apos;t have access to this activity.</p>;
  if (access === 'unavailable' && !link) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <p>Activity couldn&apos;t load.</p>
        <button className={buttonClasses({ variant: 'secondary', size: 'sm' })} type="button" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (!link) return <p className="mt-4 text-sm">This customer isn&apos;t linked.</p>;
  if (activity.status === 'unavailable' || activity.status === 'not_requested') {
    if (activity.status === 'not_requested') return null;
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <p>Activity couldn&apos;t load.</p>
        <button className={buttonClasses({ variant: 'secondary', size: 'sm' })} type="button" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (activity.status === 'not_found') return <p className="mt-4 text-sm">This contact isn&apos;t in the stored records.</p>;
  if (activity.status === 'no_activity') {
    return (
      <div className="mt-4 min-w-0 text-sm">
        <p>No activity is stored for this contact.</p>
        <CoverageDetail detail={activity.coverageDetail} />
      </div>
    );
  }
  return <ReadyActivity activity={activity} />;
}

function ReadyActivity({ activity }: { activity: Extract<PanelActivity, { status: 'ready' }> }) {
  const latest = activity.latest;
  return (
    <div className="mt-4 grid min-w-0 gap-3 break-words text-sm">
      {banner(activity) ? <p>{banner(activity)}</p> : null}
      <p><span className="font-semibold">Latest communication. </span>{latest ? `${label(latest.channel)} ${latest.direction}, ${latest.displayTime}` : 'No occurrence time is stored.'}</p>
      <p><span className="font-semibold">Follow-up. </span>{activity.followUp?.nextAction ?? 'Current follow-up status is unknown.'}</p>
      <p><span className="font-semibold">Referral agent. </span>{activity.referrioAgent ?? 'No referral agent is assigned.'}</p>
      <p><span className="font-semibold">Follow Up Boss assigned agent. </span>{activity.fubAssignedUser ? `${activity.fubAssignedUser.name} (${activity.fubAssignedUser.id})` : 'No assigned agent is stored.'}</p>
      {activity.agentsDiffer ? <p>The referral agent and the Follow Up Boss assigned agent are not the same person.</p> : null}
      <div>
        <p className="font-semibold">Projected closing</p>
        {activity.projectedClosings.length > 0 ? (
          <ul className="mt-1 list-disc pl-5">
            {activity.projectedClosings.map((closing) => (
              <li key={`${closing.display}-${closing.stage ?? 'stage'}`}>{closing.display}{closing.stage ? `, ${closing.stage}` : ''}. Projection.</li>
            ))}
          </ul>
        ) : <p>No projected closing is stored.</p>}
      </div>
      <CoverageDetail detail={activity.coverageDetail} />
    </div>
  );
}

function banner(activity: Extract<PanelActivity, { status: 'ready' }>): string | null {
  if (activity.freshnessNote !== 'Read from stored records.') return activity.freshnessNote;
  return activity.incomplete ? 'Some stored activity may be missing.' : null;
}

function CoverageDetail({ detail }: { detail: string | null }) {
  if (!detail) return null;
  return (
    <details className="min-w-0">
      <summary>Coverage</summary>
      <p className="mt-1 break-words text-foreground-muted">{detail}</p>
    </details>
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
