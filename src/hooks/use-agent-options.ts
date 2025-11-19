'use client';

import { useMemo } from 'react';
import useSWR from 'swr';

import { fetcher } from '@/utils/fetcher';

interface AgentDirectoryEntry {
  _id: string;
  name?: string | null;
}

export interface AgentOption {
  id: string;
  name: string;
}

export function useAgentOptions(enabled: boolean) {
  const { data, error, isLoading } = useSWR<AgentDirectoryEntry[]>(enabled ? '/api/agents' : null, fetcher);

  const options = useMemo<AgentOption[]>(() => {
    if (!data) {
      return [];
    }

    return data
      .map((agent) => ({
        id: agent._id,
        name: agent.name?.trim() ? agent.name.trim() : 'Unnamed Agent',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  return { options, error, isLoading };
}
