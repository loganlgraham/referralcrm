'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui/button';
import { metaPillClasses, railCardClasses, railTitleClasses, railTextButtonClasses } from '@/components/referrals/referral-rail';
import { AGENT_RECOMMENDATION_POLICY, type AgentRecommendation, type EvidenceStrength } from '@/lib/recommendations/agent-policy';
import type { AgentRecommendationResponse, RecommendationFubState } from '@/lib/recommendations/agent-recommendation-response';

const REFRESH_DELAY_MS = 250;

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'done'; body: AgentRecommendationResponse };

export function AgentRecommendationPanel({ referralId, mcId, zips }: { referralId: string; mcId: string | null; zips: readonly string[] }) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [override, setOverride] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const generation = useRef(0);
  const zipKey = zips.join(',');

  const fetchSuggestions = useCallback(async () => {
    const current = ++generation.current;
    setLoad((previous) => (previous.status === 'done' ? previous : { status: 'loading' }));
    const params = new URLSearchParams({ mcId: mcId ?? 'none', zips: zipKey });
    try {
      const response = await fetch(`/api/referrals/${referralId}/agent-recommendations?${params.toString()}`, { cache: 'no-store' });
      const body = (await response.json()) as AgentRecommendationResponse;
      if (current !== generation.current) return;
      setLoad({ status: 'done', body });
      setOverride((selected) => (selected && body.state === 'ready' && body.recommendations.some((entry) => entry.agentId === selected) ? selected : null));
    } catch {
      if (current !== generation.current) return;
      setLoad({ status: 'error' });
    }
  }, [mcId, referralId, zipKey]);

  useEffect(() => {
    const timer = setTimeout(() => void fetchSuggestions(), REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [fetchSuggestions]);

  const body = load.status === 'done' ? load.body : null;
  const ranked = body?.state === 'ready' ? body.recommendations : [];
  const overrideAgent = override ? ranked.find((entry) => entry.agentId === override) ?? null : null;

  if (body && (body.state === 'denied' || body.state === 'not_applicable')) return null;

  const top = ranked[0] ?? null;
  const alternatives = ranked.slice(1, 3);

  return (
    <section className={`${railCardClasses} min-w-0 max-w-full`} aria-labelledby="agent-recommendation-title" aria-busy={load.status === 'loading'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="agent-recommendation-title" className={railTitleClasses}>Suggested agent</h2>
        <span className={metaPillClasses}>Preview</span>
      </div>
      <p className="mt-0.5 text-[13px] text-foreground-subtle">Draft suggestion. It does not assign anyone.</p>

      {load.status === 'loading' ? <p className="mt-4 text-sm">Loading suggestions…</p> : null}
      {load.status === 'error' || body?.state === 'unavailable' ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <p>Suggestions couldn&apos;t load.</p>
          <button className={buttonClasses({ variant: 'secondary', size: 'sm' })} type="button" onClick={() => void fetchSuggestions()}>Retry</button>
        </div>
      ) : null}
      {body && body.state !== 'ready' && body.state !== 'unavailable' ? <p className="mt-4 text-sm">{emptyMessage(body.state)}</p> : null}

      {top ? (
        <div className="mt-4 grid min-w-0 gap-3 text-sm">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-words text-base font-semibold text-foreground">{top.name}</p>
              <EvidenceBadge strength={top.evidenceStrength} />
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-foreground-muted">
              {top.reasons.map((reason) => <li key={reason} className="break-words">{reason}</li>)}
            </ul>
          </div>

          {alternatives.length > 0 ? (
            <div className="min-w-0">
              <p className="text-eyebrow text-foreground-subtle">Alternatives</p>
              <ul className="mt-1 grid gap-1">
                {alternatives.map((entry) => (
                  <li key={entry.agentId} className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-words">{entry.name}</span>
                    <EvidenceBadge strength={entry.evidenceStrength} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {overrideAgent ? (
            <div className="rounded-md border border-dashed border-border px-3 py-2" role="status">
              <p className="font-semibold">Preview selection — not assigned.</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="break-words">{overrideAgent.name}</span>
                <EvidenceBadge strength={overrideAgent.evidenceStrength} />
                <button className={`${railTextButtonClasses} ml-auto`} type="button" onClick={() => setOverride(null)}>Clear</button>
              </div>
            </div>
          ) : null}

          {choosing ? (
            <label className="grid gap-1">
              <span>Preview a different agent</span>
              <select
                className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
                value={override ?? ''}
                onChange={(event) => {
                  setOverride(event.target.value || null);
                  setChoosing(false);
                }}
              >
                <option value="">Use the suggestion</option>
                {ranked.map((entry) => (
                  <option key={entry.agentId} value={entry.agentId}>{`${entry.rank}. ${entry.name} (${entry.evidenceStrength.toLowerCase()} evidence)`}</option>
                ))}
              </select>
            </label>
          ) : (
            <div>
              <button className={buttonClasses({ variant: 'secondary', size: 'md' })} type="button" onClick={() => setChoosing(true)}>Choose another agent</button>
            </div>
          )}

          <CalculationDetails body={body} shown={[top, ...alternatives, ...(overrideAgent && overrideAgent.rank > 3 ? [overrideAgent] : [])]} />
        </div>
      ) : null}
    </section>
  );
}

function EvidenceBadge({ strength }: { strength: EvidenceStrength }) {
  return <span className={metaPillClasses}>{`${strength} evidence`}</span>;
}

function emptyMessage(state: Exclude<AgentRecommendationResponse['state'], 'ready' | 'unavailable'>): string {
  switch (state) {
    case 'needs_bucket':
      return 'Set the agent bucket to see suggestions.';
    case 'needs_zip':
      return 'Add a ZIP to see out-of-state suggestions.';
    case 'no_candidates':
      return 'No active agents in this bucket match these ZIPs.';
    case 'denied':
    case 'not_applicable':
      return '';
    default: {
      const never: never = state;
      throw new Error(`Unexpected state: ${String(never)}`);
    }
  }
}

export function fubSentence(state: RecommendationFubState, adjusted: number): string {
  switch (state) {
    case 'applied':
      return `Stored Follow Up Boss activity moved ${adjusted === 1 ? '1 agent' : `${adjusted} agents`} by up to ${AGENT_RECOMMENDATION_POLICY.fubMaxAdjustment} points.`;
    case 'insufficient':
      return 'Follow Up Boss activity was read, but too few agents had enough complete activity to compare, so it was not used.';
    case 'not_permitted':
      return 'Uses Referrio data only. Follow Up Boss activity is not available for your account.';
    case 'not_linked':
      return 'Uses Referrio data only. No eligible agents are linked to Follow Up Boss users.';
    case 'not_connected':
      return 'Uses Referrio data only. Follow Up Boss is not connected here.';
    case 'unavailable':
      return "Uses Referrio data only. Follow Up Boss activity couldn't load.";
    default: {
      const never: never = state;
      throw new Error(`Unexpected state: ${String(never)}`);
    }
  }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function record(successes: number, trials: number): string {
  return trials === 0 ? 'No record' : `${successes} of ${trials}`;
}

function CalculationDetails({ body, shown }: { body: AgentRecommendationResponse | null; shown: AgentRecommendation[] }) {
  if (!body || body.state !== 'ready' || !body.baselines) return null;
  const weights = AGENT_RECOMMENDATION_POLICY.weights;
  const windowStart = body.totals.windowStart ? new Date(body.totals.windowStart).toLocaleDateString('en-US', { timeZone: 'America/Denver' }) : '';
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer text-foreground-muted">How this was calculated</summary>
      <div className="mt-2 grid min-w-0 gap-3 text-foreground-muted">
        <p className="break-words">
          {`Weights: MC success ${weights.mc * 100}%, ZIP success ${weights.zip * 100}%, overall close rate ${weights.overall * 100}%, financed with AFC ${weights.usedAfc * 100}%, active workload ${weights.workload * 100}%. Each part is scored 0–100, where the group average is 50.`}
        </p>
        <p className="break-words">{`Compared ${body.totals.eligible} eligible ${body.inputs.bucket === 'AHA_OOS' ? 'out-of-state' : 'AHA'} agents on referrals since ${windowStart}${body.inputs.mcName ? ` with ${body.inputs.mcName}` : ''}${body.inputs.zips.length ? ` in ${body.inputs.zips.join(', ')}` : ''}.`}</p>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-xs">
            <thead>
              <tr className="text-foreground-subtle">
                <th className="py-1 pr-2 font-semibold">Agent</th>
                <th className="py-1 pr-2 font-semibold">MC</th>
                <th className="py-1 pr-2 font-semibold">ZIP</th>
                <th className="py-1 pr-2 font-semibold">Overall</th>
                <th className="py-1 pr-2 font-semibold">AFC</th>
                <th className="py-1 pr-2 font-semibold">Active</th>
                <th className="py-1 font-semibold">Score</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.agentId} className="border-t border-border align-top">
                  <td className="break-words py-1 pr-2">{entry.name}</td>
                  <td className="py-1 pr-2">{entry.factors.mc.applicable ? record(entry.factors.mc.successes, entry.factors.mc.trials) : 'No MC'}</td>
                  <td className="py-1 pr-2">{entry.factors.zip.applicable ? record(entry.factors.zip.successes, entry.factors.zip.trials) : 'No ZIP'}</td>
                  <td className="py-1 pr-2">{record(entry.factors.overall.successes, entry.factors.overall.trials)}</td>
                  <td className="py-1 pr-2">{record(entry.factors.usedAfc.successes, entry.factors.usedAfc.trials)}</td>
                  <td className="py-1 pr-2">{entry.factors.workload.active}</td>
                  <td className="py-1">{entry.fub.state === 'applied' && entry.fub.points !== 0 ? `${entry.score} (${entry.fub.points > 0 ? '+' : ''}${entry.fub.points} FUB)` : entry.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="break-words">{`Group averages: close rate ${percent(body.baselines.overall)}, with this MC ${percent(body.baselines.mc)}, in these ZIPs ${percent(body.baselines.zip)}, financed with AFC ${percent(body.baselines.usedAfc)}. Typical workload: ${body.workloadMedian ?? 0} active.`}</p>
        <p className="break-words">{fubSentence(body.fub.state, body.fub.adjustedAgents)}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Close rates count finished referrals only: closed versus lost or terminated. Active referrals and projected closings are left out.</li>
          <li>{`Small records are pulled toward the group average (${AGENT_RECOMMENDATION_POLICY.priorStrength} referrals' worth), so an agent with no history scores average rather than high or low.`}</li>
          <li>Losses marked as never reached, already had an agent, not qualified, no longer buying, out of area, already bought, or bad contact info are not counted against the agent.</li>
          <li>AFC financing counts closed purchases only. Sales, open deals, and fallen-through deals are left out. This answer is saved as yes unless someone changes it at closing.</li>
          <li>A closing goes to the agent on the deal record. Agents who were reassigned away do not get the result.</li>
          {body.inputs.bucket === 'AHA' ? <li>Local AHA agents rarely list ZIP coverage, so coverage is not required for them.</li> : <li>Out-of-state agents must list one of these ZIPs. Nearby ZIPs are not checked.</li>}
        </ul>
      </div>
    </details>
  );
}
