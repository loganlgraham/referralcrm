'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import useSWR from 'swr';

import { REFERRAL_STATUSES } from '@/constants/referrals';
import { fetcher } from '@/utils/fetcher';

interface DirectoryOption {
  _id: string;
  name: string;
  email?: string | null;
}

export function Filters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    startTransition(() => {
      const queryString = params.toString();
      router.replace(queryString ? `/referrals?${queryString}` : '/referrals');
    });
  };

  const { data: agents } = useSWR<DirectoryOption[]>('/api/agents', fetcher);
  const { data: lenders } = useSWR<DirectoryOption[]>('/api/lenders', fetcher);

  const agentValue = searchParams.get('agent') ?? '';
  const lenderValue = searchParams.get('mc') ?? '';

  return (
    <div className="grid gap-4 rounded-lg bg-white p-4 shadow-sm md:grid-cols-5">
      <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
        Status
        <select
          defaultValue={searchParams.get('status') ?? ''}
          onChange={(event) => handleChange('status', event.target.value)}
          className="mt-1 rounded border border-slate-200 px-2 py-1 text-sm"
          disabled={isPending}
        >
          <option value="">All</option>
          {REFERRAL_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
        MC
        <select
          value={lenderValue}
          onChange={(event) => handleChange('mc', event.target.value)}
          className="mt-1 rounded border border-slate-200 px-2 py-1 text-sm"
          disabled={isPending}
        >
          <option value="">All</option>
          {lenders?.map((lender) => (
            <option key={lender._id} value={lender._id}>
              {lender.name}
              {lender.email ? ` (${lender.email})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
        Agent
        <select
          value={agentValue}
          onChange={(event) => handleChange('agent', event.target.value)}
          className="mt-1 rounded border border-slate-200 px-2 py-1 text-sm"
          disabled={isPending}
        >
          <option value="">All</option>
          {agents?.map((agentOption) => (
            <option key={agentOption._id} value={agentOption._id}>
              {agentOption.name}
              {agentOption.email ? ` (${agentOption.email})` : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
        State
        <input
          type="text"
          maxLength={2}
          defaultValue={searchParams.get('state') ?? ''}
          onBlur={(event) => handleChange('state', event.target.value.toUpperCase())}
          className="mt-1 rounded border border-slate-200 px-2 py-1 text-sm"
          placeholder="CO"
          disabled={isPending}
        />
      </label>
      <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
        Zip
        <input
          type="text"
          defaultValue={searchParams.get('zip') ?? ''}
          onBlur={(event) => handleChange('zip', event.target.value)}
          className="mt-1 rounded border border-slate-200 px-2 py-1 text-sm"
          placeholder="80202"
          disabled={isPending}
        />
      </label>
    </div>
  );
}
