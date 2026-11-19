import type { AgentRecommendation, FactorKey } from '@/lib/recommendations/agent-policy';

export type RecommendationFubState = 'applied' | 'insufficient' | 'not_permitted' | 'not_linked' | 'not_connected' | 'unavailable';

export type AgentRecommendationResponse = {
  officialScoring: false;
  preview: true;
  policyVersion: string;
  state: 'ready' | 'not_applicable' | 'needs_bucket' | 'needs_zip' | 'no_candidates' | 'denied' | 'unavailable';
  generatedAt: string;
  inputs: { mcId: string | null; mcName: string | null; zips: string[]; bucket: 'AHA' | 'AHA_OOS' | null };
  recommendations: AgentRecommendation[];
  totals: {
    eligible: number;
    inactive: number;
    noZipCoverage: number;
    windowStart: string;
    resolvedOutcomes: number;
    activeOutcomes: number;
    excludedOutcomes: number;
  };
  baselines: Record<Exclude<FactorKey, 'workload'>, number> | null;
  workloadMedian: number | null;
  fub: { state: RecommendationFubState; linkedAgents: number; adjustedAgents: number };
};

export function emptyRecommendationResponse(state: AgentRecommendationResponse['state'], policyVersion: string): AgentRecommendationResponse {
  return {
    officialScoring: false,
    preview: true,
    policyVersion,
    state,
    generatedAt: new Date().toISOString(),
    inputs: { mcId: null, mcName: null, zips: [], bucket: null },
    recommendations: [],
    totals: { eligible: 0, inactive: 0, noZipCoverage: 0, windowStart: '', resolvedOutcomes: 0, activeOutcomes: 0, excludedOutcomes: 0 },
    baselines: null,
    workloadMedian: null,
    fub: { state: 'not_permitted', linkedAgents: 0, adjustedAgents: 0 },
  };
}
