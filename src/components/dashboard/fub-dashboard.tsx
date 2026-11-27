'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { Modal } from '@/components/ui/modal';
import { buttonClasses } from '@/components/ui/button';
import { FubFirstCallTiming } from '@/components/dashboard/fub-first-call-timing';
import { FubDay31Decision } from '@/components/dashboard/fub-day31-decision';
import type { FubDashboardData, SopAudit, SopAuditKind } from '@/lib/intelligence/sop-contract';
import type { Day31DecisionRecord } from '@/lib/intelligence/sop-decisions';

type EvidenceKind = 'calls' | 'tasks' | SopAuditKind;
type EvidenceRow = Omit<FubDashboardData['evidence']['calls'][number], 'id'> & { id: number | string; audit?: SopAudit };
const auditKinds = ['day-3', 'day-7', 'day-31'] as const;
const isAuditKind = (kind: string): kind is SopAuditKind => auditKinds.some((value) => value === kind);
const evidenceLabels: Record<EvidenceKind, string> = {
  calls: 'recorded calls', tasks: 'task evidence', 'day-3': 'Day 3 reminders', 'day-7': 'Day 7 reminders', 'day-31': 'Day 31 reviews',
};
const evidenceDescriptions: Record<EvidenceKind, string> = {
  calls: 'These calls are recorded in FUB. This list does not establish the first call or prove every call is present.',
  tasks: 'Only tasks with a documented open status and due date are included. Missing task details are not counted as overdue.',
  'day-3': 'These FUB notes match the Day 3 reminder for fewer than two calls. Missing reminders do not prove the standard was met. Agent names show the current customer owner.',
  'day-7': 'These FUB notes match the Day 7 reminder for fewer than four calls. Missing reminders do not prove the standard was met. Agent names show the current customer owner.',
  'day-31': 'Each observed Day 31 marker needs an explicit Keep or Release decision. The date shows when the marker was observed, not an assumed handoff date. Recent conversation or continued ownership does not count as a decision. Reviews remain available across date ranges.',
};
const number = (value: number) => value.toLocaleString('en-US');
const time = (value: string, dateOnly = false) => {
  const date = new Date(
    dateOnly ? `${value.slice(0, 10)}T12:00:00-07:00` : value,
  );
  if (Number.isNaN(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
  }).format(date);
};

export function FubDashboard({ userId, configured = true }: { userId: string; configured?: boolean }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, error, isLoading, mutate } = useSWR<FubDashboardData>(
    configured ? [`/api/dashboard/fub?days=${days}`, userId] : null,
    ([url]: [string, string]) => fetcher(url),
    { refreshInterval: 60_000, shouldRetryOnError: false },
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            Follow Up Boss · SOP overview
          </h2>
          <p className="mt-1 text-sm text-foreground-muted">
            Follow-up standards, documented activity, and the evidence behind
            each number.
          </p>
        </div>
        <label className="text-sm text-foreground-muted">
          Calls and reminders
          <span className="relative ml-2 inline-flex">
            <select
              className="appearance-none rounded-lg border border-border bg-surface py-2 pl-3 pr-9 text-foreground"
              value={days}
              onChange={(event) =>
                setDays(Number(event.target.value) as 7 | 30 | 90)
              }
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground" />
          </span>
        </label>
      </div>
      {!configured ? (
        <div role="status" className="rounded-card border border-border bg-surface p-5">
          <h3 className="font-semibold">FUB data connection is not ready</h3>
          <p className="mt-2 text-sm text-foreground-muted">
            You have access to this dashboard, but this environment has not been connected
            to the FUB evidence service yet. Live SOP numbers and evidence are unavailable.
          </p>
        </div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-card border border-border bg-surface p-5"
        >
          <p>
            FUB evidence could not be loaded. Access may have changed, or the
            connection may be temporarily unavailable.
          </p>
          <button
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            onClick={() => void mutate()}
          >
            Try again
          </button>
        </div>
      ) : isLoading || !data ? (
        <p
          role="status"
          className="rounded-card border border-border bg-surface p-6 text-foreground-muted"
        >
          Loading FUB evidence…
        </p>
      ) : (
        <FubDashboardView key={`${userId}:${days}`} data={data} onDataChange={() => { void mutate(); }} />
      )}
    </div>
  );
}

export function FubDashboardView({ data, onDataChange }: { data: FubDashboardData; onDataChange?: () => void }) {
  const [selection, setSelection] = useState<{
    kind: EvidenceKind;
    agentId: number | null;
  } | null>(null);
  const [page, setPage] = useState(0);
  const [reviewFilter, setReviewFilter] = useState<'pending' | 'all' | 'keep' | 'release'>('pending');
  const [savedDecisions, setSavedDecisions] = useState<Day31DecisionRecord[]>([]);
  const decisions = new Map<string, Day31DecisionRecord>();
  for (const record of [...(data.day31Decisions ?? []), ...savedDecisions]) {
    const key = `${record.personId}:${record.reviewId}`;
    if ((decisions.get(key)?.revision ?? -1) < record.revision) decisions.set(key, record);
  }
  const decisionFor = (review: SopAudit) => decisions.get(`${review.personId}:${review.id}`);
  const reviews = data.sopAudits ?? [];
  const pendingReviews = reviews.filter((review) => review.kind === 'day-31' && !decisionFor(review));
  const day31Ready = typeof data.sopMetrics?.find((metric) => metric.id === 'day-31')?.count === 'number' && Array.isArray(data.day31Decisions) && !data.decisionError;
  const onSaved = (record: Day31DecisionRecord) => {
    setSavedDecisions((previous) => [...previous.filter((item) => item.personId !== record.personId || item.reviewId !== record.reviewId), record]);
    setReviewFilter('all');
    onDataChange?.();
  };
  const open = (kind: EvidenceKind, agentId: number | null = null) => {
    setSelection({ kind, agentId });
    setPage(0);
    setReviewFilter('pending');
  };
  const names = new Map(data.agents.map((agent) => [agent.id, agent.name]));
  const matchingRows: EvidenceRow[] = selection
    ? (isAuditKind(selection.kind)
      ? reviews.filter((review) => review.kind === selection.kind)
        .filter((review) => review.kind !== 'day-31' || reviewFilter === 'all' || (reviewFilter === 'pending' ? !decisionFor(review) : decisionFor(review)?.decision === reviewFilter))
        .map((review) => ({ id: review.sourceNoteId ?? review.id, personId: review.personId, customer: review.customer, agentId: review.agentId,
          at: review.at, dateOnly: false, detail: review.provenance === 'tag_observation' ? 'The Day 31 review marker was observed in FUB. An explicit Keep or Release decision is required.' : review.kind === 'day-31' ? 'This FUB note matches the Day 31 Keep or Release review.' : `This FUB note matches the ${review.kind === 'day-3' ? 'Day 3' : 'Day 7'} follow-up reminder.`, audit: review }))
      : data.evidence[selection.kind]).filter(
        (row) =>
          selection.agentId === null ||
          (selection.agentId === 0
            ? row.agentId === null || !names.has(row.agentId)
            : row.agentId === selection.agentId),
      )
    : [];
  const rows = matchingRows;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1));
  const visible = rows.slice(currentPage * 25, (currentPage + 1) * 25);
  const metrics = data.metrics.map((legacy) => {
    const observed = data.sopMetrics?.find((metric) => metric.id === legacy.id);
    if (!observed) return legacy;
    if (observed.id === 'day-31') return { ...observed, evidence: 'day-31' as const,
      count: day31Ready ? pendingReviews.length : null,
      detail: data.decisionError ?? `${pendingReviews.length} awaiting a decision; ${reviews.filter((review) => review.kind === 'day-31').length - pendingReviews.length} decided. ${observed.detail}` };
    return { ...observed, evidence: observed.id };
  });
  const unavailable = (data.sopCoverage && data.sopCoverage.state !== 'current') || data.coverage.some(
    (row) =>
      row.failed ||
      !row.lastSuccessAt ||
      Date.parse(data.readAt) - Date.parse(row.lastSuccessAt) >
        24 * 60 * 60 * 1000,
  );
  return (
    <>
      <div className="rounded-card border border-border bg-surface px-5 py-4 text-sm">
        <p>
          <strong>{number(data.customers)}</strong> eligible customers ·{' '}
          <strong>{number(data.evidence.calls.length)}</strong> recorded
          outgoing calls in the last {data.days} days
        </p>
        <p className="mt-1 text-foreground-muted">
          Evidence is shown as of {time(data.readAt)} MT. These are documented
          facts, not agent grades. Missing evidence is not a failed SOP.
        </p>
        <details className="mt-2 text-foreground-muted">
          <summary className="cursor-pointer">
            {unavailable
              ? 'Some collection data needs attention'
              : 'Collection updates'}
          </summary>
          <ul className="mt-2 space-y-1">
            {data.coverage.map((item) => (
              <li key={item.resource}>
                {item.resource === 'roster'
                  ? 'Customers'
                  : item.resource === 'calls'
                    ? 'Calls'
                    : 'Tasks'}
                :{' '}
                {item.lastSuccessAt
                  ? `${time(item.lastSuccessAt)} MT`
                  : 'Not yet available'}
                {item.failed ? ' · latest refresh failed' : ''}
              </li>
            ))}
          </ul>
          {data.sopCoverage ? <p className="mt-2">SOP reminders: {data.sopCoverage.detail}</p> : null}
        </details>
      </div>
      <section
        className="overflow-hidden rounded-card border border-border bg-surface shadow-card"
        aria-label="SOP standards"
      >
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-semibold">Main SOP standards</h3>
          <p className="mt-1 text-sm text-foreground-muted">
            Review the available evidence before drawing a conclusion.
          </p>
        </div>
        <div className="divide-y divide-border">
          {metrics.map((metric) => metric.id === 'first-call' && data.firstCallReport !== undefined ? (
            <FubFirstCallTiming key={metric.id} report={data.firstCallReport} />
          ) : (
            <div
              key={metric.id}
              className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_10rem_2fr] md:gap-5"
            >
              <h4 className="font-medium">{metric.label}</h4>
              <p className="text-sm font-semibold">
                {metric.count === null ? (
                  <span className="text-foreground-muted">Not enough data</span>
                ) : (
                  <button
                    className="underline underline-offset-4"
                    onClick={() => { if (metric.evidence !== 'none') open(metric.evidence); }}
                  >
                    {number(metric.count)} {metric.id === 'day-31' ? 'awaiting decision' : isAuditKind(metric.id) ? 'reminders' : 'documented'}
                  </button>
                )}
              </p>
              <div className="text-sm text-foreground-muted">
                <p>{metric.detail}</p>
                {metric.evidence !== 'none' ? (
                  <button
                    className="mt-2 font-medium text-foreground underline underline-offset-4"
                    onClick={() => { if (metric.evidence !== 'none') open(metric.evidence); }}
                  >
                    View{' '}
                    {evidenceLabels[metric.evidence]}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section
        className="overflow-hidden rounded-card border border-border bg-surface shadow-card"
        aria-label="Agent activity"
      >
        <div className="border-b border-border px-5 py-4">
          <h3 className="font-semibold">By agent</h3>
          <p className="mt-1 text-sm text-foreground-muted">
            Calls follow the recorded caller; tasks follow the task assignee. Reminders and reviews follow the current customer owner.
            Counts are not rankings.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-subtle text-foreground-muted">
              <tr>
                <th className="px-5 py-3">Agent</th>
                <th className="px-5 py-3 text-right">Current customers</th>
                <th className="px-5 py-3 text-right">Recorded calls</th>
                <th className="px-5 py-3 text-right">
                  Documented overdue tasks
                </th>
                {data.sopAudits ? <><th className="px-5 py-3 text-right">Day 3 reminders</th><th className="px-5 py-3 text-right">Day 7 reminders</th><th className="px-5 py-3 text-right">Day 31 awaiting decision</th></> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.agents.map((agent) => (
                <tr key={agent.id}>
                  <th scope="row" className="px-5 py-3 font-medium">
                    {agent.name}
                    {agent.role && agent.role !== 'Agent' ? (
                      <span className="ml-2 font-normal text-foreground-muted">
                        ({agent.role})
                      </span>
                    ) : null}
                  </th>
                  <td className="px-5 py-3 text-right">
                    {agent.id === 0 ? '—' : number(agent.customers)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      aria-label={`View recorded calls for ${agent.name}`}
                      className="underline underline-offset-4"
                      onClick={() => open('calls', agent.id)}
                    >
                      {number(agent.calls)}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button
                      aria-label={`View overdue tasks for ${agent.name}`}
                      className="underline underline-offset-4"
                      onClick={() => open('tasks', agent.id)}
                    >
                      {number(agent.overdueTasks)}
                    </button>
                  </td>
                  {data.sopAudits ? auditKinds.map((kind) => {
                    const available = kind === 'day-31' ? day31Ready : typeof data.sopMetrics?.find((metric) => metric.id === kind)?.count === 'number';
                    const source = kind === 'day-31' ? pendingReviews : reviews.filter((review) => review.kind === kind);
                    const total = source.filter((review) => agent.id === 0 ? review.agentId === null || !names.has(review.agentId) : review.agentId === agent.id).length;
                    return <td key={kind} className="px-5 py-3 text-right"><button disabled={!available}
                      aria-label={`View ${evidenceLabels[kind]} for ${agent.name}`} className="underline underline-offset-4 disabled:no-underline"
                      onClick={() => open(kind, agent.id)}>{available ? number(total) : '—'}</button></td>;
                  }) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {data.agents.length === 0 ? (
            <p className="p-5 text-foreground-muted">
              No agent records are available yet.
            </p>
          ) : null}
        </div>
      </section>
      <Modal
        isOpen={selection !== null}
        onClose={() => setSelection(null)}
        title={
          selection?.kind === 'calls' ? 'Recorded call evidence' : selection?.kind === 'tasks' ? 'Overdue task evidence' : selection ? evidenceLabels[selection.kind] : 'SOP evidence'
        }
        description={`${selection?.agentId === null ? 'All agents' : (names.get(selection?.agentId ?? -1) ?? 'Unattributed activity')} · Times are Mountain Time`}
        size="lg"
      >
        <div className="space-y-4 px-5 py-4">
          <div className="space-y-3 text-sm leading-relaxed text-foreground-muted">
          <p>
            {selection ? evidenceDescriptions[selection.kind] : ''}
          </p>
          {selection && isAuditKind(selection.kind) && data.sopCoverage ? <p>{data.sopCoverage.detail}</p> : null}
          </div>
          {selection?.kind === 'day-31' ? <div>
            {data.decisionError ? <p role="alert" className="mb-2 text-sm text-danger">{data.decisionError}</p> : null}
            <label className="text-sm">Show reviews <select aria-label="Show Day 31 reviews" value={reviewFilter}
              onChange={(event) => { setReviewFilter(event.target.value as typeof reviewFilter); setPage(0); }}
              className="ml-2 rounded-lg border border-border bg-surface px-3 py-2">
              <option value="pending">Awaiting decision</option><option value="all">All reviews</option><option value="keep">Keep</option><option value="release">Release</option>
            </select></label>
          </div> : null}
          {visible.length === 0 ? (
            <p className="py-5 text-foreground-muted">
              No matching evidence is available. This does not prove no activity
              occurred.
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((row) => (
                <li key={`${row.personId}:${row.id}`} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <a
                      className="min-w-0 break-words font-medium underline underline-offset-4"
                      href={`https://americanhomeagents3.followupboss.com/2/people/view/${row.personId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.customer}
                    </a>
                    <span className="text-xs leading-relaxed text-foreground-muted sm:shrink-0 sm:text-right">
                      {time(row.at, row.dateOnly)}
                      {row.dateOnly ? ' · date only' : row.audit?.provenance === 'tag_observation' ? ' MT · marker observed' : ' MT'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">{row.detail}</p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {names.get(row.agentId ?? -1) ?? 'Assignee not recorded'} ·{' '}
                    {row.audit?.provenance === 'tag_observation' ? 'Day 31 marker in FUB' : `${row.audit ? 'FUB note' : selection?.kind === 'calls' ? 'Call' : 'Task'} #${row.id}`}
                  </p>
                  {row.audit && row.audit.provenance !== 'tag_observation' ? <p className="mt-1 text-xs text-foreground-muted">{row.audit.provenance === 'automation' ? 'Confirmed automation reminder.' : 'Reminder text matched; automatic creation has not been confirmed.'}</p> : null}
                  {row.audit?.kind === 'day-31' && Array.isArray(data.day31Decisions) && !data.decisionError ? <FubDay31Decision review={row.audit} record={decisionFor(row.audit)} onSaved={onSaved} /> : null}
                </li>
              ))}
            </ul>
          )}
          {rows.length > 25 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <button
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <span className="text-sm">
                {currentPage * 25 + 1}–{Math.min((currentPage + 1) * 25, rows.length)} of{' '}
                {number(rows.length)}
              </span>
              <button
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                disabled={(currentPage + 1) * 25 >= rows.length}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
