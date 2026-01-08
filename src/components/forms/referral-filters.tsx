'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import useSWR from 'swr';

import { REFERRAL_STATUSES, REFERRAL_TIMELINE_OPTIONS } from '@/constants/referrals';
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
  const searchParamsString = useMemo(() => searchParams.toString(), [searchParams]);

  const isAgentMode = mode === 'agent';
  const isAdminMode = mode === 'admin';
  const showAhaBucket = isAdminMode;

  const searchValue = searchParams.get('search') ?? '';
  const [searchTerm, setSearchTerm] = useState(searchValue);
  const [debouncedSearch, setDebouncedSearch] = useState(searchValue);
  const isTypingRef = useRef(false);

  const handleChange = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParamsString);
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
    [router, searchParamsString, startTransition]
  );

  const { data: agents } = useSWR<DirectoryOption[]>(isAgentMode ? null : '/api/agents', fetcher);
  const { data: lenders } = useSWR<DirectoryOption[]>('/api/lenders', fetcher);

  const sortedAgents = useMemo(() => {
    if (!agents || !Array.isArray(agents)) return undefined;
    return [...agents].sort((a, b) => {
      const nameA = a.name?.toLowerCase() ?? '';
      const nameB = b.name?.toLowerCase() ?? '';
      return nameA.localeCompare(nameB);
    });
  }, [agents]);

  const agentValue = isAgentMode ? '' : searchParams.get('agent') ?? '';
  const lenderValue = searchParams.get('mc') ?? '';
  const ahaBucketValue = showAhaBucket ? searchParams.get('ahaBucket') ?? '' : '';
  const agentReferralValue = isAdminMode ? searchParams.get('agentReferrals') ?? '' : '';
  const timelineValue = searchParams.get('timeline') ?? '';

  useEffect(() => {
    if (isTypingRef.current) {
      return;
    }

    setSearchTerm(searchValue);
    setDebouncedSearch(searchValue);
  }, [searchValue]);

  useEffect(() => {
    const params = new URLSearchParams(searchParamsString);
    const existing = params.get('search') ?? '';
    const trimmed = debouncedSearch.trim();

    if (trimmed === existing.trim()) {
      return;
    }

    if (!trimmed) {
      params.delete('search');
    } else {
      params.set('search', trimmed);
    }

    startTransition(() => {
      const queryString = params.toString();
      router.replace(queryString ? `/referrals?${queryString}` : '/referrals');
    });
  }, [debouncedSearch, router, searchParamsString, startTransition]);

  const handleSearchInput = useCallback((value: string) => {
    isTypingRef.current = true;
    setSearchTerm(value);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(searchTerm);
      isTypingRef.current = false;
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  return (
    <div className="space-y-4 rounded-lg bg-white p-4 shadow-sm">
      <label className="flex flex-col text-xs font-semibold text-slate-600">
        Search
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => handleSearchInput(event.target.value)}
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
            Agent Designation
            <select
              value={ahaBucketValue}
              onChange={(event) => handleChange('ahaBucket', event.target.value)}
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
              disabled={isPending}
            >
              <option value="">All</option>
              <option value="AHA">AHA</option>
              <option value="AHA_OOS">AHA OOS</option>
              <option value="AGIT">AGIT</option>
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
            {Array.isArray(lenders) && lenders.map((lender) => (
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
              {Array.isArray(sortedAgents) && sortedAgents.map((agentOption) => (
                <option key={agentOption._id} value={agentOption._id}>
                  {agentOption.name}
                  {agentOption.email ? ` (${agentOption.email})` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col text-xs font-semibold uppercase text-slate-500">
          Timeline
          <select
            value={timelineValue}
            onChange={(event) => handleChange('timeline', event.target.value)}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-sm"
            disabled={isPending}
          >
            <option value="">All</option>
            {REFERRAL_TIMELINE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
