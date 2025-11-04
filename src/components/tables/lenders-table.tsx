'use client';

import useSWR from 'swr';
import { fetcher } from '@/utils/fetcher';

interface LenderRow {
  _id: string;
  name: string;
  email: string;
  phone: string;
  nmlsId: string;
  team?: string;
  region?: string;
}

export function LendersTable() {
  const { data } = useSWR<LenderRow[]>('/api/lenders', fetcher);
  if (!data) return <div className="rounded-lg bg-white p-4 shadow-sm">Loading lenders…</div>;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Lender</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">NMLS</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Team</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Region</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((lender) => (
            <tr key={lender._id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-700">
                <div className="font-medium text-slate-900">{lender.name}</div>
                <div className="text-xs text-slate-500">{lender.email}</div>
                <div className="text-xs text-slate-500">{lender.phone}</div>
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">{lender.nmlsId}</td>
              <td className="px-4 py-3 text-sm text-slate-700">{lender.team ?? '—'}</td>
              <td className="px-4 py-3 text-sm text-slate-700">{lender.region ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
