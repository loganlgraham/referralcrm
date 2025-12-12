'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import useSWR from 'swr';

import { REFERRAL_STATUSES } from '@/constants/referrals';
import { fetcher } from '@/utils/fetcher';

type FilterMode = 'admin' | 'mc' | 'agent';

interface DirectoryOption {
  _id: string;
  name: string;
  email?: string | null;
}

interface FiltersProps {
  mode?: FilterMode;
}

export function Filters({ mode = 'admin' }: FiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  
  const isAgentMode = mode === 'agent';
  const isAdminMode = mode === 'admin';
  const showAhaBucket = isAdminMode;

  const searchValue = searchParams.get('search') ?? '';
  const [searchTerm, setSearchTerm] = useState(searchValue);

  const handleChange = useCallback(
    (key: string, value: string) => {
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
    },
    [router, searchParams, startTransition]
  );

  const { data: agents } = useSWR<DirectoryOption[]>(isAgentMode ? null : '/api/agents', fetcher);
  const { data: lenders } = useSWR<DirectoryOption[]>('/api/lenders', fetcher);

  const agentValue = isAgentMode ? '' : searchParams.get('agent') ?? '';
  const lenderValue = searchParams.get('mc') ?? '';
  const ahaBucketValue = showAhaBucket ? searchParams.get('ahaBucket') ?? '' : '';
  const agentReferralValue = isAdminMode ? searchParams.get('agentReferrals') ?? '' : '';

  const lastAppliedSearchRef = useRef(searchValue);

  useEffect(() => {
    if (searchValue !== searchTerm) {
      lastAppliedSearchRef.current = searchValue;
      setSearchTerm(searchValue);
    }
  }, [searchTerm, searchValue]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchTerm === lastAppliedSearchRef.current) {
        return;
      }
      lastAppliedSearchRef.current = searchTerm;
      handleChange('search', searchTerm);
    }, 200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [handleChange, searchTerm]);

  return (
    <div className="space-y-4 rounded-lg bg-white p-4 shadow-sm">
      <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
        Search
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-200 px-4 py-3 text-base shadow-sm"
          placeholder="Name, email, phone, loan #"
        />
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
          Status
          <select
            defaultValue={searchParams.get('status') ?? ''}
            onChange={(event) => handleChange('status', event.target.value)}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
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
        {isAdminMode && (
          <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
            Agent referrals
            <select
              value={agentReferralValue}
              onChange={(event) => handleChange('agentReferrals', event.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
              disabled={isPending}
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        )}
        {showAhaBucket && (
          <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
            AHA Bucket
            <select
              value={ahaBucketValue}
              onChange={(event) => handleChange('ahaBucket', event.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
              disabled={isPending}
            >
              <option value="">All</option>
              <option value="AHA">AHA</option>
              <option value="AHA_OOS">AHA OOS</option>
            </select>
          </label>
        )}
        <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
          MC
          <select
            value={lenderValue}
            onChange={(event) => handleChange('mc', event.target.value)}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
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
        {!isAgentMode && (
          <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
            Agent
            <select
              value={agentValue}
              onChange={(event) => handleChange('agent', event.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
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
        )}
        {!isAgentMode && (
          <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
            State
            <input
              type="text"
              maxLength={2}
              defaultValue={searchParams.get('state') ?? ''}
              onBlur={(event) => handleChange('state', event.target.value.toUpperCase())}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
              placeholder="CO"
              disabled={isPending}
            />
          </label>
        )}
        <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
          Zip
          <input
            type="text"
            defaultValue={searchParams.get('zip') ?? ''}
            onBlur={(event) => handleChange('zip', event.target.value)}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            placeholder="80202"
            disabled={isPending}
          />
        </label>
      </div>
    </div>
  );
}
