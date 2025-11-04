'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { REFERRAL_STATUSES } from '@/constants/referrals';

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
      router.replace(`/referrals?${params.toString()}`);
    });
  };

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
        <input
          type="text"
          defaultValue={searchParams.get('mc') ?? ''}
          onBlur={(event) => handleChange('mc', event.target.value)}
          className="mt-1 rounded border border-slate-200 px-2 py-1 text-sm"
          placeholder="Name or email"
          disabled={isPending}
        />
      </label>
      <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
        Agent
        <input
          type="text"
          defaultValue={searchParams.get('agent') ?? ''}
          onBlur={(event) => handleChange('agent', event.target.value)}
          className="mt-1 rounded border border-slate-200 px-2 py-1 text-sm"
          placeholder="Name or email"
          disabled={isPending}
        />
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
