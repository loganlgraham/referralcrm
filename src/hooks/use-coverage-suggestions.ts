import useSWR from 'swr';

import { fetcher } from '@/utils/fetcher';

export interface CoverageSuggestion {
  id: string;
  value: string;
}

interface CoverageSuggestionResponse {
  suggestions: CoverageSuggestion[];
}

export function useCoverageSuggestions() {
  const { data, mutate, isLoading } = useSWR<CoverageSuggestionResponse>(
    '/api/agents/coverage-suggestions',
    fetcher
  );

  return {
    suggestions: data?.suggestions ?? [],
    mutate,
    isLoading
  };
}

