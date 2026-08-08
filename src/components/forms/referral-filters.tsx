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

function StatusMultiSelect({
  selected,
  onChange,
  disabled
}: {
  selected: string[];
  onChange: (statuses: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggle = (status: string) => {
    const next = selected.includes(status)
      ? selected.filter((s) => s !== status)
      : [...selected, status];
    onChange(next);
  };

  const label = selected.length === 0 ? 'All' : `${selected.length} selected`;

  return (
    <div ref={containerRef} className="relative flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
      Status
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        className="mt-1 w-full rounded border border-border bg-surface-raised px-3 py-2 text-left text-sm normal-case text-foreground-muted disabled:opacity-50"
      >
        {label}
        <span className="float-right text-foreground-subtle">&#9662;</span>
      </button>
      {open && (
        <div className="absolute top-full z-20 mt-1 max-h-60 w-full overflow-y-auto rounded border border-border bg-surface-raised py-1 shadow-lg">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full px-3 py-1.5 text-left text-sm normal-case text-accent hover:bg-surface-muted"
            >
              Clear all
            </button>
          )}
          {REFERRAL_STATUSES.map((status) => (
            <label
              key={status}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm normal-case text-foreground-muted hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                checked={selected.includes(status)}
                onChange={() => toggle(status)}
                className="h-3.5 w-3.5 rounded border-border-strong text-accent focus:ring-accent/30"
              />
              {status}
            </label>
          ))}
        </div>
      )}
    </div>
  );
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
  const searchParamsStringRef = useRef(searchParamsString);

  useEffect(() => {
    searchParamsStringRef.current = searchParamsString;
  }, [searchParamsString]);

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

  const { data: agentsResponse } = useSWR<{ items: DirectoryOption[] }>(
    isAgentMode ? null : '/api/agents?minimal=true&all=true',
    fetcher
  );
  const { data: lendersResponse } = useSWR<{ items: DirectoryOption[] }>(
    '/api/lenders?minimal=true&all=true',
    fetcher
  );

  const agents = agentsResponse?.items;
  const lenders = lendersResponse?.items;

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
    const params = new URLSearchParams(searchParamsStringRef.current);
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
  }, [debouncedSearch, router, startTransition]);

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
    <div className="space-y-4 rounded-xl border border-border bg-surface-muted/50 p-4">
      <label className="flex flex-col text-xs font-semibold text-foreground-muted">
        Search
        <input
          type="text"
          value={searchTerm}
          onChange={(event) => handleSearchInput(event.target.value)}
          className="mt-2 w-full rounded-lg border border-border bg-surface-raised px-4 py-3 text-base shadow-sm"
          placeholder="Name, email, phone, loan #"
        />
      </label>
      <div
        className={
          isAgentMode
            ? 'grid grid-cols-1 gap-4 sm:grid-cols-3'
            : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6'
        }
      >
        <StatusMultiSelect
          selected={searchParams.get('status')?.split(',').filter(Boolean) ?? []}
          onChange={(statuses) => handleChange('status', statuses.join(','))}
          disabled={isPending}
        />
        {isAdminMode && (
          <label className="flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
            Agent referrals
            <select
              value={agentReferralValue}
              onChange={(event) => handleChange('agentReferrals', event.target.value)}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              disabled={isPending}
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        )}
        {showAhaBucket && (
          <label className="flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
            Agent Designation
            <select
              value={ahaBucketValue}
              onChange={(event) => handleChange('ahaBucket', event.target.value)}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
              disabled={isPending}
            >
              <option value="">All</option>
              <option value="AHA">AHA</option>
              <option value="AHA_OOS">AHA OOS</option>
              <option value="AGIT">AGIT</option>
            </select>
          </label>
        )}
        <label className="flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
          MC
          <select
            value={lenderValue}
            onChange={(event) => handleChange('mc', event.target.value)}
            className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
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
          <label className="flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
            Agent
            <select
              value={agentValue}
              onChange={(event) => handleChange('agent', event.target.value)}
              className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
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
        <label className="flex flex-col text-xs font-semibold uppercase text-foreground-subtle">
          Timeline
          <select
            value={timelineValue}
            onChange={(event) => handleChange('timeline', event.target.value)}
            className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
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
