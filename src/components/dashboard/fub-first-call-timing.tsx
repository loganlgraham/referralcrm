'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { buttonClasses } from '@/components/ui/button';
import { timingStatus, type FirstCallReport, type FirstCallRow } from '@/lib/intelligence/first-call-timing';

const formatTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const displayTime = (value: string) => formatTime.format(new Date(value));
const labels = { confirmed: 'Referrio confirmed', observed: 'FUB owner change observed' };
const sources = ['confirmed', 'observed'] as const;
const statuses = ['Called within 10 min', 'No call recorded within 10 min', 'Within first 10 min', 'Assignment ended before 10 min', 'Live connection'] as const;
const pageSize = 25;

function elapsed(row: FirstCallRow) {
  if (!row.callAt) return '';
  const seconds = Math.floor((Date.parse(row.callAt) - Date.parse(row.assignedAt)) / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function FubFirstCallTiming({ report }: { report: FirstCallReport | null }) {
  const [source, setSource] = useState<FirstCallRow['source'] | null>(null);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  if (!report) return <div className="px-5 py-4"><h4 className="font-medium">First recorded call after assignment</h4>
    <p role="status" className="mt-1 text-sm text-foreground-muted">Assignment timing is temporarily unavailable.</p></div>;
  const matches = report.rows.filter(row => row.source === source && (filter === 'all' || timingStatus(row, report.readAt) === filter));
  const lastPage = Math.max(0, Math.ceil(matches.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  return <div className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_2fr]">
    <h4 className="font-medium">First recorded call after assignment</h4>
    <div className="space-y-2 text-sm">
      {sources.map(kind => {
        const rows = report.rows.filter(row => row.source === kind);
        const timely = rows.filter(row => timingStatus(row, report.readAt) === 'Called within 10 min').length;
        return <div key={kind}><button className="font-medium underline underline-offset-4" onClick={() => {
          setSource(kind); setFilter('all'); setPage(0);
        }}>{labels[kind]} · {rows.length} {rows.length === 1 ? 'assignment' : 'assignments'}</button>
          <span className="ml-2 text-foreground-muted">{timely} with a call within 10 min</span></div>;
      })}
      <p className="text-foreground-muted">FUB timing starts when we first see the new agent. Calls placed outside FUB may be missing.</p>
    </div>
    <Modal isOpen={source !== null} onClose={() => setSource(null)} title={source ? labels[source] : 'Assignment timing'}
      description="First recorded outbound call by the assigned agent. Times are Mountain Time." size="lg">
      <div className="space-y-3 px-5 py-4 text-sm">
        <label>Show <select className="ml-2 rounded-lg border border-border bg-surface px-3 py-2" value={filter}
          onChange={event => { setFilter(event.target.value); setPage(0); }}>
          <option value="all">All assignments</option>
          {statuses.map(label => <option key={label}>{label}</option>)}
        </select></label>
        {!matches.length && <p>No matching assignments in this period.</p>}
        {matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row =>
          <div key={`${row.personId}-${row.agentId}-${row.assignedAt}`} className="space-y-1 rounded-xl border border-border p-4">
            <a className="font-medium underline" target="_blank" rel="noopener noreferrer" href={`https://americanhomeagents3.followupboss.com/2/people/view/${row.personId}`}>{row.customer}</a>
            <p>{row.agentName} · {timingStatus(row, report.readAt)}</p>
            <p className="text-foreground-muted">{row.source === 'confirmed' ? 'Assignment confirmed' : 'New owner first observed'} {displayTime(row.assignedAt)}</p>
            {row.callAt && <p>First recorded call {displayTime(row.callAt)} · {elapsed(row)} later</p>}
          </div>)}
        {lastPage > 0 && <div className="flex items-center justify-between">
          <button className={buttonClasses({ variant: 'secondary', size: 'sm' })} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage + 1} of {lastPage + 1}</span>
          <button className={buttonClasses({ variant: 'secondary', size: 'sm' })} disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
        </div>}
      </div>
    </Modal>
  </div>;
}
