'use client';

import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';

interface AgentRow {
  _id: string;
  name: string;
  email: string;
  phone: string;
  statesLicensed: string[];
  zipCoverage: string[];
  closings12mo: number;
  npsScore?: number;
  avgResponseHours?: number;
}

export function AgentsTable() {
  const { data } = useSWR<AgentRow[]>('/api/agents', fetcher);
  if (!data) return <div className="rounded-lg bg-white p-4 shadow-sm">Loading agents…</div>;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Agent</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">States</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Zip coverage</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Closings (12mo)</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">NPS</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Avg response</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((agent) => (
            <tr key={agent._id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-700">
                <div className="font-medium text-slate-900">{agent.name}</div>
                <div className="text-xs text-slate-500">{agent.email}</div>
                <div className="text-xs text-slate-500">{agent.phone}</div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">{agent.statesLicensed.join(', ')}</td>
              <td className="px-4 py-3 text-sm text-slate-700">{agent.zipCoverage.slice(0, 5).join(', ')}...</td>
              <td className="px-4 py-3 text-sm text-slate-700">{agent.closings12mo}</td>
              <td className="px-4 py-3 text-sm text-slate-700">{agent.npsScore ?? '—'}</td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {agent.avgResponseHours ? `${agent.avgResponseHours} hrs` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
