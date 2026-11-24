'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';
import { Modal } from '@/components/ui/modal';
import { buttonClasses } from '@/components/ui/button';
import type { SopDashboard } from '@/lib/intelligence/sop-contract';

type EvidenceKind = 'calls' | 'tasks';
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
  const { data, error, isLoading, mutate } = useSWR<SopDashboard>(
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
          Recorded calls
          <select
            className="ml-2 rounded-lg border border-border bg-surface px-3 py-2 text-foreground"
            value={days}
            onChange={(event) =>
              setDays(Number(event.target.value) as 7 | 30 | 90)
            }
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
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
        <FubDashboardView key={days} data={data} />
      )}
    </div>
  );
}

export function FubDashboardView({ data }: { data: SopDashboard }) {
  const [selection, setSelection] = useState<{
    kind: EvidenceKind;
    agentId: number | null;
  } | null>(null);
  const [page, setPage] = useState(0);
  const open = (kind: EvidenceKind, agentId: number | null = null) => {
    setSelection({ kind, agentId });
    setPage(0);
  };
  const names = new Map(data.agents.map((agent) => [agent.id, agent.name]));
  const rows = selection
    ? data.evidence[selection.kind].filter(
        (row) =>
          selection.agentId === null ||
          (selection.agentId === 0
            ? row.agentId === null || !names.has(row.agentId)
            : row.agentId === selection.agentId),
      )
    : [];
  const visible = rows.slice(page * 25, (page + 1) * 25);
  const unavailable = data.coverage.some(
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
          Tasks are shown as of {time(data.readAt)} MT. These are documented
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
          {data.metrics.map((metric) => (
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
                    onClick={() => open('tasks')}
                  >
                    {number(metric.count)} documented
                  </button>
                )}
              </p>
              <div className="text-sm text-foreground-muted">
                <p>{metric.detail}</p>
                {metric.evidence !== 'none' ? (
                  <button
                    className="mt-2 font-medium text-foreground underline underline-offset-4"
                    onClick={() => open(metric.evidence as EvidenceKind)}
                  >
                    View{' '}
                    {metric.evidence === 'calls'
                      ? 'recorded calls'
                      : 'task evidence'}
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
            Calls follow the recorded caller; tasks follow the task assignee.
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
          selection?.kind === 'calls'
            ? 'Recorded call evidence'
            : 'Overdue task evidence'
        }
        description={`${selection?.agentId === null ? 'All agents' : (names.get(selection?.agentId ?? -1) ?? 'Unattributed activity')} · Times are Mountain Time`}
        size="lg"
      >
        <p className="mb-4 text-sm text-foreground-muted">
          {selection?.kind === 'calls'
            ? 'These calls are recorded in FUB. This list does not establish the first call or prove every call is present.'
            : 'Only tasks with a documented open status and due date are included. Missing task details are not counted as overdue.'}
        </p>
        {visible.length === 0 ? (
          <p className="py-5 text-foreground-muted">
            No matching evidence is available. This does not prove no activity
            occurred.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((row) => (
              <li key={`${row.personId}:${row.id}`} className="py-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <a
                    className="font-medium underline underline-offset-4"
                    href={`https://americanhomeagents3.followupboss.com/2/people/view/${row.personId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {row.customer}
                  </a>
                  <span className="text-sm text-foreground-muted">
                    {time(row.at, row.dateOnly)}
                    {row.dateOnly ? ' · date only' : ' MT'}
                  </span>
                </div>
                <p className="mt-1 text-sm">{row.detail}</p>
                <p className="mt-1 text-xs text-foreground-muted">
                  {names.get(row.agentId ?? -1) ?? 'Assignee not recorded'} ·{' '}
                  {selection?.kind === 'calls' ? 'Call' : 'Task'} #{row.id}
                </p>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 25 ? (
          <div className="mt-4 flex items-center justify-between">
            <button
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <span className="text-sm">
              {page * 25 + 1}–{Math.min((page + 1) * 25, rows.length)} of{' '}
              {number(rows.length)}
            </span>
            <button
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
              disabled={(page + 1) * 25 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
