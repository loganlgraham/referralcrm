'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Contact } from '@/components/referrals/contact-assignment';
import { toast } from 'sonner';
import { buttonClasses } from '@/components/ui/button';
import { metaPillClasses, railCardClasses, railTitleClasses, railTextButtonClasses } from '@/components/referrals/referral-rail';
import { AGENT_RECOMMENDATION_POLICY, DRAFT_WORKLOAD_STAGE_WEIGHTS } from '@/lib/recommendations/agent-policy-config';
import type { AgentRecommendation, EvidenceStrength } from '@/lib/recommendations/agent-policy';
import type { AgentRecommendationResponse, RecommendationFubState } from '@/lib/recommendations/agent-recommendation-response';

const REFRESH_DELAY_MS = 250;

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'done'; body: AgentRecommendationResponse };

export function AgentRecommendationPanel({
  referralId,
  mcId,
  zips,
  reviewIntakeSuggestion = false,
  assignedAgentId = null,
  canPersistAssignment = false,
  embedded = false,
  assignedAgentName = null,
  side = 'buy',
  onAssigned,
}: {
  referralId: string;
  mcId: string | null;
  zips: readonly string[];
  reviewIntakeSuggestion?: boolean;
  assignedAgentId?: string | null;
  canPersistAssignment?: boolean;
  embedded?: boolean;
  assignedAgentName?: string | null;
  side?: 'buy' | 'sell';
  onAssigned?: (agent: Contact) => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [override, setOverride] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const initiallyExpanded = !assignedAgentId || reviewIntakeSuggestion;
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const contentId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const zipKey = zips.join(',');

  useEffect(() => {
    setExpanded(initiallyExpanded);
  }, [referralId, assignedAgentId, initiallyExpanded]);

  const fetchSuggestions = useCallback(async () => {
    const current = ++generation.current;
    setLoad({ status: 'loading' });
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
    if (!expanded) return;
    setLoad({ status: 'loading' });
    const timer = setTimeout(() => void fetchSuggestions(), REFRESH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [expanded, fetchSuggestions]);

  const persistAssignment = async (agentId: string) => {
    if (!canPersistAssignment || !agentId) return;
    setAssigning(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, side }),
      });
      if (!response.ok) throw new Error('Unable to save agent selection');
      const { agent } = await response.json() as { agent?: Contact | null };
      const ranked = load.status === 'done' && load.body.state === 'ready' ? load.body.recommendations : [];
      const chosen = ranked.find((entry) => entry.agentId === agentId);
      setOverride(null);
      onAssigned?.(agent ?? { id: agentId, name: chosen?.name, ahaDesignation: load.status === 'done' ? load.body.inputs.bucket : null });
      setExpanded(false);
      toggle.current?.focus();
      toast.success(`Assigned ${chosen?.name ?? 'agent'}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save agent selection');
    } finally {
      setAssigning(false);
      setChoosing(false);
    }
  };

  const body = load.status === 'done' ? load.body : null;
  const ranked = body?.state === 'ready' ? body.recommendations : [];
  const overrideAgent = override ? ranked.find((entry) => entry.agentId === override) ?? null : null;

  if (body && (body.state === 'denied' || body.state === 'not_applicable')) return null;

  const top = ranked[0] ?? null;
  const alternatives = ranked.slice(1, 3);
  const panelClasses = embedded
    ? 'min-w-0 max-w-full rounded-xl border border-border bg-surface-subtle p-3'
    : `${railCardClasses} min-w-0 max-w-full`;
  const HeadingTag = embedded ? 'h3' : 'h2';

  const useAgent = (entry: AgentRecommendation) => {
    if (canPersistAssignment) {
      void persistAssignment(entry.agentId);
      return;
    }
    setOverride(entry.agentId);
  };

  return (
    <section className={panelClasses} aria-labelledby={contentId + '-title'}>
      <HeadingTag id={contentId + '-title'} className={railTitleClasses}>
        <button
          ref={toggle}
          type="button"
          className="flex w-full items-center justify-between gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded(!expanded)}
        >
          Suggested agent
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-foreground-muted transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </HeadingTag>
      {!expanded && assignedAgentName && <p className="mt-1 break-words text-xs text-foreground-muted">Assigned to {assignedAgentName}</p>}
      <div id={contentId} hidden={!expanded} aria-busy={expanded && load.status === 'loading'}>
        {expanded && (
          <>
            {!canPersistAssignment && <p className="mt-1 text-xs text-foreground-muted">Preview only</p>}
            {body?.state === 'ready' && body.provisional ? (
              <p className="mt-1 text-xs text-foreground-subtle" role="note">
                Provisional suggestion — every eligible agent has limited history (fewer than {AGENT_RECOMMENDATION_POLICY.minResolvedForEvidence} finished referrals).
              </p>
            ) : null}

            {load.status === 'loading' ? <p className="mt-4 text-sm">Loading suggestions…</p> : null}
            {load.status === 'error' || body?.state === 'unavailable' ? (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <p>Suggestions couldn&apos;t load.</p>
                <button className={buttonClasses({ variant: 'secondary', size: 'sm' })} type="button" onClick={() => void fetchSuggestions()}>Retry</button>
              </div>
            ) : null}
            {body && body.state !== 'ready' && body.state !== 'unavailable' ? <p className="mt-4 text-sm">{emptyMessage(body.state)}</p> : null}
            {body?.state === 'ready' && !top ? (
              <p className="mt-4 text-sm">No eligible agent suggestion for this referral yet.</p>
            ) : null}

            {top ? (
              <div className="mt-4 grid min-w-0 gap-3 text-sm">
                <div className="min-w-0">
                  <div className="grid min-w-0 gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words text-base font-semibold text-foreground">{top.name}</p>
                      <EvidenceBadge strength={top.evidenceStrength} />
                    </div>
                    <button
                      className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                      type="button"
                      disabled={assigning || (top.agentId === assignedAgentId && !reviewIntakeSuggestion)}
                      onClick={() => useAgent(top)}
                    >
                      {top.agentId === assignedAgentId && !reviewIntakeSuggestion ? 'Currently assigned' : `Use ${top.name}`}
                    </button>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-foreground-muted">Why this suggestion</summary>
                    <RecommendationReasons entry={top} />
                  </details>
                </div>

                {alternatives.length > 0 ? (
                  <div className="min-w-0">
                    <p className="text-eyebrow text-foreground-subtle">Alternatives</p>
                    <ul className="mt-1 divide-y divide-border">
                      {alternatives.map((entry) => (
                        <li key={entry.agentId}>
                          <details className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm py-2 font-medium text-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                              <span className="min-w-0 break-words">{entry.name}</span>
                              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-foreground-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                            </summary>
                            <div className="pb-3">
                              <EvidenceBadge strength={entry.evidenceStrength} />
                              <RecommendationReasons entry={entry} />
                              {entry.agentId === assignedAgentId && !reviewIntakeSuggestion ? (
                                <p className="mt-2 text-xs text-foreground-muted">Currently assigned</p>
                              ) : (
                                <button className={`${railTextButtonClasses} mt-2`} type="button" disabled={assigning} onClick={() => useAgent(entry)}>
                                  {canPersistAssignment ? 'Assign this agent' : 'Preview this agent'}
                                </button>
                              )}
                            </div>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {overrideAgent && !canPersistAssignment ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-2" role="status">
                    <p className="font-semibold">Preview selection — not assigned.</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="break-words">{overrideAgent.name}</span>
                      <EvidenceBadge strength={overrideAgent.evidenceStrength} />
                      <button className={`${railTextButtonClasses} ml-auto`} type="button" onClick={() => setOverride(null)}>Clear</button>
                    </div>
                  </div>
                ) : null}

                {ranked.length > 3 && (choosing ? (
                  <label className="grid gap-1">
                    <span>{canPersistAssignment ? 'Choose a different agent' : 'Preview a different agent'}</span>
                    <select
                      className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
                      value={overrideAgent && overrideAgent.rank > 3 ? overrideAgent.agentId : ''}
                      disabled={assigning}
                      onChange={(event) => {
                        const next = event.target.value || null;
                        if (canPersistAssignment && next) {
                          void persistAssignment(next);
                          return;
                        }
                        setOverride(next);
                        setChoosing(false);
                      }}
                    >
                      <option value="">Select an agent</option>
                      {ranked.slice(3).map((entry) => (
                        <option key={entry.agentId} value={entry.agentId}>{`${entry.rank}. ${entry.name} (${entry.evidenceStrength.toLowerCase()} evidence)`}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div>
                    <button
                      className={buttonClasses({ variant: 'secondary', size: 'md' })}
                      type="button"
                      disabled={assigning}
                      onClick={() => setChoosing(true)}
                    >
                      Choose another agent
                    </button>
                  </div>
                ))}

                <CalculationDetails body={body} shown={[top, ...alternatives, ...(overrideAgent && overrideAgent.rank > 3 ? [overrideAgent] : [])]} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function RecommendationReasons({ entry }: { entry: AgentRecommendation }) {
  return (
    <>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-foreground-muted">
        {entry.reasons.map((reason) => <li key={reason} className="break-words">{reason}</li>)}
      </ul>
      {entry.unknownLossReasons > 0 && (
        <p className="mt-1 text-xs text-foreground-subtle">{unknownLossLabel(entry.unknownLossReasons)} not counted.</p>
      )}
    </>
  );
}

function EvidenceBadge({ strength }: { strength: EvidenceStrength }) {
  return <span className={metaPillClasses}>{`${strength} evidence`}</span>;
}

function emptyMessage(state: Exclude<AgentRecommendationResponse['state'], 'ready' | 'unavailable'>): string {
  switch (state) {
    case 'needs_bucket':
      return 'Add a valid search ZIP to see agent suggestions.';
    case 'needs_zip':
      return 'Add a ZIP to see out-of-state suggestions.';
    case 'no_candidates':
      return 'No eligible agents match this referral. Out-of-state agents need a recorded destination-state license and a matching closed-deal or coverage ZIP.';
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
    case 'paused':
      return 'Uses Referrio data only. Follow Up Boss activity is not part of the score yet.';
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
  return trials === 0 ? '—' : `${successes}/${trials}`;
}

function contractRecord(entry: AgentRecommendation): string {
  const contract = entry.factors.contract;
  if (contract.trials === 0) return '—';
  if (!contract.applicable) return `${contract.successes} known`;
  return record(contract.successes, contract.trials);
}

function unknownLossLabel(count: number): string {
  return `${count} ${count === 1 ? 'loss' : 'losses'} with no reason recorded`;
}

function workloadBreakdown(entry: AgentRecommendation): string {
  const workload = entry.factors.workload;
  const stages = Object.entries(DRAFT_WORKLOAD_STAGE_WEIGHTS).map(([stage, weight]) => {
    const count = workload.stageCounts[stage as keyof typeof DRAFT_WORKLOAD_STAGE_WEIGHTS] ?? 0;
    return `${stage} ${count} (x${weight})`;
  });
  return `${entry.name}: ${stages.join(', ')}; Under Contract ${workload.underContract} (separate); weighted load ${workload.weightedActive}.`;
}

function comparisonScope(body: AgentRecommendationResponse, windowStart: string): string {
  const pool = body.inputs.bucket === 'AHA_OOS' ? 'out-of-state' : 'AHA';
  const area = body.inputs.zips.length === 0
    ? ''
    : body.inputs.radiusMiles !== null
      ? ` licensed in the destination state with closed-deal or coverage ZIPs within ${body.inputs.radiusMiles} miles of ${body.inputs.zips.join(', ')}`
      : '';
  return `Compared ${body.totals.eligible} eligible ${pool} agents${area}, using referrals since ${windowStart}${body.inputs.mcName ? `. MC: ${body.inputs.mcName}` : ''}.`;
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
          {`Weights: MC success ${percent(weights.mc)}, overall close rate ${percent(weights.overall)}, contract rate ${percent(weights.contract)}, active workload ${percent(weights.workload)}, ZIP success ${percent(weights.zip)}, financed with AFC ${percent(weights.usedAfc)}. Each part is scored 0–100, where the group average is 50.`}
        </p>
        <p className="break-words">{comparisonScope(body, windowStart)}</p>
        <p className="break-words">
          {body.inputs.bucket === 'AHA_OOS'
            ? 'Exact closed-deal ZIP matches come first, then exact coverage, nearby closed deals, and nearby coverage. The other pairing criteria rank agents within each group.'
            : 'Looking-in ZIPs do not affect AHA suggestions. Adam Pippin and Kristen Truong are excluded.'}
        </p>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[300px] text-left text-xs">
            <thead>
              <tr className="text-foreground-subtle">
                <th className="py-1 pr-2 font-semibold">Agent</th>
                <th className="py-1 pr-2 font-semibold">MC</th>
                <th className="py-1 pr-2 font-semibold">Close finished</th>
                <th className="py-1 pr-2 font-semibold">Contract known</th>
                <th className="py-1 pr-2 font-semibold">ZIP</th>
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
                  <td className="py-1 pr-2">{record(entry.factors.overall.successes, entry.factors.overall.trials)}</td>
                  <td className="py-1 pr-2">{contractRecord(entry)}</td>
                  <td className="py-1 pr-2">{entry.factors.zip.applicable ? record(entry.factors.zip.successes, entry.factors.zip.trials) : 'No ZIP'}</td>
                  <td className="py-1 pr-2">{record(entry.factors.usedAfc.successes, entry.factors.usedAfc.trials)}</td>
                  <td className="py-1 pr-2">{entry.factors.workload.active}</td>
                  <td className="py-1">{entry.fub.state === 'applied' && entry.fub.points !== 0 ? `${entry.score} (${entry.fub.points > 0 ? '+' : ''}${entry.fub.points} FUB)` : entry.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs">
          {`Close (finished only): closed out of finished referrals since ${windowStart}; active referrals and excused or unknown-reason losses are excluded. Contract known: conversion is ranked only when there are documented contracts and documented failures to reach contract; positive-only contract evidence is shown as a count. Terminated contracts count, duplicate deals on the same referral count once, and active referrals without contract evidence are excluded. AFC: closed purchases financed with AFC. — means no record yet.`}
        </p>
        {shown.some((entry) => entry.unknownLossReasons > 0) ? (
          <p className="break-words text-xs">{`Losses with no reason recorded, not counted: ${shown.filter((entry) => entry.unknownLossReasons > 0).map((entry) => `${entry.name} ${entry.unknownLossReasons}`).join(', ')}.`}</p>
        ) : null}
        <p className="break-words">{`Group averages: close rate ${percent(body.baselines.overall)} (also the comparison point for MC and ZIP results), contract conversion ${percent(body.baselines.contract)} where enough contract outcomes exist${body.baselines.usedAfc > 0 ? `, financed with AFC ${percent(body.baselines.usedAfc)}` : ''}. Typical weighted workload: ${body.workloadMedian ?? 0}.`}</p>
        <div className="grid gap-1 text-xs">
          <p className="font-semibold text-foreground-muted">Draft workload weights: New Lead 1, Paired 2, In Communication 3, Active Lead 4. Under Contract is shown separately until its capacity weight is defined.</p>
          {shown.filter((entry) => entry.factors.workload.known).map((entry) => (
            <p key={`workload-${entry.agentId}`} className="break-words">{workloadBreakdown(entry)}</p>
          ))}
        </div>
        <p className="break-words">{fubSentence(body.fub.state, body.fub.adjustedAgents)}</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Close rates count finished referrals only: closed versus lost or terminated. Active referrals and projected closings are left out.</li>
          <li>Contract conversion needs both documented contracts and documented failures to reach contract. Missing contract evidence is not a failure, and positive-only contract evidence is shown but scored neutral.</li>
          <li>{`Small records are pulled toward the group average (${AGENT_RECOMMENDATION_POLICY.priorStrength} referrals' worth), so a 1-for-1 record does not outrank solid history and an agent with no history scores average.`}</li>
          <li>{`Agents with fewer than ${AGENT_RECOMMENDATION_POLICY.minResolvedForEvidence} finished referrals have limited history. Workload alone cannot put them above an eligible agent with adequate history and comparable or stronger outcomes. Inactive or capacity-blocked agents stay out of the list.`}</li>
          {body.provisional ? <li>Every eligible agent has limited history, so this suggestion is provisional.</li> : null}
          <li>Losses marked as never reached, already had an agent, not qualified, no longer buying, out of area, already bought, or bad contact info are not counted against the agent. Losses with no reason recorded are shown but not counted.</li>
          <li>AFC financing counts only answers given on the closing form. Older closings and defaulted answers are unknown and left out.</li>
          <li>A closing or contract goes to the agent on the deal record. Agents who were reassigned away do not get the result.</li>
          {body.inputs.bucket === 'AHA'
            ? <li>AHA suggestions use the entire active AHA pool, except Adam Pippin and Kristen Truong. ZIP success is neutral for everyone.</li>
            : <li>{`Out-of-state agents need a recorded license in the destination state and a closed deal or coverage within ${AGENT_RECOMMENDATION_POLICY.nearbyZipMiles} miles. ZIP success uses only past referrals with documented deal ZIPs matching these exact ZIPs.`}</li>}
        </ul>
      </div>
    </details>
  );
}
