import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentRecommendationPanel } from '@/components/referrals/agent-recommendation-panel';
import type { AgentRecommendation } from '@/lib/recommendations/agent-policy';
import type { AgentRecommendationResponse } from '@/lib/recommendations/agent-recommendation-response';

function rec(id: string, name: string, rank: number): AgentRecommendation {
  const rate = { successes: 2, trials: 4, baseline: 0.3, adjusted: 0.4, points: 60, applicable: true };
  return {
    agentId: id,
    name,
    rank,
    score: 70 - rank,
    baseScore: 70 - rank,
    outcomeScore: 55 - rank,
    adequateHistory: rank === 1,
    evidenceStrength: rank === 1 ? 'Strong' : 'Limited',
    coverage: 'not_listed',
    factors: {
      mc: rate,
      overall: rate,
      contract: rate,
      zip: rate,
      usedAfc: rate,
      workload: {
        active: 2,
        weightedActive: 6,
        underContract: rank === 1 ? 1 : 0,
        stageCounts: { 'New Lead': 0, Paired: 1, 'In Communication': 0, 'Active Lead': 1 },
        poolMedian: 2,
        points: 50,
        known: true,
      },
    },
    excludedOutcomes: rank === 1 ? 3 : 0,
    unknownLossReasons: rank === 1 ? 3 : 0,
    afcUnknown: 0,
    missingOutcomes: rank === 1 ? 3 : 0,
    outcomeCompleteness: rank === 1 ? 4 / 7 : 1,
    fub: { state: 'neutral', reason: 'paused' },
    reasons: [`${name} reason one`, `${name} reason two`, `${name} reason three`],
  };
}

function body(names: string[], overrides: Partial<AgentRecommendationResponse> = {}): AgentRecommendationResponse {
  return {
    officialScoring: false,
    preview: true,
    policyVersion: 'test',
    state: 'ready',
    provisional: false,
    generatedAt: '2026-11-19T20:00:00.000Z',
    inputs: { mcId: 'mc', mcName: 'Karim L', zips: ['80014'], bucket: 'AHA', radiusMiles: null },
    recommendations: names.map((name, index) => rec(`id-${name}`, name, index + 1)),
    totals: { eligible: names.length, inactive: 0, outsideRadius: 0, windowStart: '2024-11-19T20:00:00.000Z', resolvedOutcomes: 4, activeOutcomes: 0, excludedOutcomes: 3, unknownLossReasons: 3 },
    baselines: { overall: 0.3, mc: 0.3, contract: 0.5, zip: 0.3, usedAfc: 0 },
    workloadMedian: 2,
    fub: { state: 'paused', linkedAgents: 0, adjustedAgents: 0 },
    ...overrides,
  };
}

function respond(value: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: async () => value } as Response);
}

describe('agent recommendation panel', () => {
  const originalFetch = global.fetch;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  async function flush() {
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  }

  it('shows one suggestion, expandable reasons for each alternative without assigning in preview', async () => {
    global.fetch = jest.fn(() => respond(body(['Ana', 'Ben', 'Cy', 'Dee']))) as typeof fetch;
    render(<AgentRecommendationPanel referralId="r1" mcId="mc" zips={['80014']} embedded />);
    await flush();
    expect(screen.getByRole('button', { name: 'Suggested agent' })).toHaveAttribute('aria-expanded', 'true');
    expect((await screen.findAllByText('Ana')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Use Ana' })).toBeInTheDocument();
    expect(screen.getByText('Why this suggestion')).toBeInTheDocument();
    expect(screen.getAllByText(/Ana reason/)).toHaveLength(3);
    const alternatives = screen.getByText('Alternatives').parentElement as HTMLElement;
    expect(alternatives).toHaveTextContent('Ben');
    expect(alternatives).toHaveTextContent('Cy');
    const ben = within(alternatives).getByText('Ben');
    expect(within(alternatives).getAllByText('Ben')).toHaveLength(1);
    const row = ben.closest('details')!;
    expect(row.open).toBe(false);
    fireEvent.click(ben.closest('summary')!);
    expect(row.open).toBe(true);
    expect(within(row).getAllByText(/Ben reason/)).toHaveLength(3);
    expect(within(row).getByRole('button', { name: 'Preview this agent' })).toBeVisible();
    expect(within(alternatives).getByText('Cy').closest('details')!.open).toBe(false);
    expect(screen.queryByText('Dee')).not.toBeInTheDocument();
    expect(screen.getByText('Strong evidence')).toBeInTheDocument();
    expect(screen.getByText('Preview only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign|send|follow up boss/i })).not.toBeInTheDocument();
    expect(screen.getByText('How this was calculated')).toBeInTheDocument();
    expect(screen.getByText('Uses Referrio data only. Follow Up Boss activity is not part of the score yet.')).toBeInTheDocument();
    expect(screen.getByText('3 losses with no reason recorded not counted.')).toBeInTheDocument();
    expect(screen.getByText('Contract known')).toBeInTheDocument();
    expect(screen.getByText(/Close \(finished only\): closed out of finished referrals since 11\/19\/2024/)).toBeInTheDocument();
    expect(screen.getByText(/Contract known: conversion is ranked only when there are documented contracts and documented failures to reach contract/)).toBeInTheDocument();
    expect(screen.getByText(/Draft workload weights: New Lead 1, Paired 2, In Communication 3, Active Lead 4/)).toBeInTheDocument();
    expect(screen.getByText(/Ana: New Lead 0 \(x1\), Paired 1 \(x2\), In Communication 0 \(x3\), Active Lead 1 \(x4\); Under Contract 1 \(separate\); weighted load 6/)).toBeInTheDocument();
  });

  it('starts collapsed for an assigned referral, reopens on demand and reacts to a Team assignment', async () => {
    global.fetch = jest.fn(() => respond(body(['Ana', 'Ben']))) as typeof fetch;
    const props = { referralId: 'r1', mcId: null, zips: ['80014'], canPersistAssignment: true };
    const { rerender } = render(<AgentRecommendationPanel {...props} assignedAgentId="id-Ben" assignedAgentName="Ben" />);
    const toggle = screen.getByRole('button', { name: 'Suggested agent' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Assigned to Ben')).toBeVisible();
    await flush();
    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    await flush();
    expect(screen.getByRole('button', { name: 'Use Ana' })).toBeVisible();
    rerender(<AgentRecommendationPanel {...props} assignedAgentId="id-Ana" assignedAgentName="Ana" />);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    rerender(<AgentRecommendationPanel {...props} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the intake suggestion open until confirmed and collapses after a successful alternative assignment', async () => {
    const agent = { id: 'id-Ben', name: 'Ben', ahaDesignation: 'AHA', phone: '303-555-0100' };
    const onAssigned = jest.fn();
    global.fetch = jest.fn((url, init) => init?.method === 'POST' ? respond({ agent }) : respond(body(['Ana', 'Ben']))) as typeof fetch;
    render(<AgentRecommendationPanel referralId="r1" mcId={null} zips={[]} assignedAgentId="id-Ana" assignedAgentName="Ana" reviewIntakeSuggestion canPersistAssignment side="sell" onAssigned={onAssigned} />);
    await flush();
    expect(screen.getByRole('button', { name: 'Use Ana' })).toBeEnabled();
    const row = screen.getByText('Alternatives').parentElement!.querySelector('details')!;
    fireEvent.click(within(row).getByText('Ben'));
    expect(onAssigned).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Assign this agent' }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith(agent));
    expect(global.fetch).toHaveBeenCalledWith('/api/referrals/r1/assign', expect.objectContaining({ body: JSON.stringify({ agentId: 'id-Ben', side: 'sell' }) }));
    expect(screen.getByRole('button', { name: 'Suggested agent' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the suggestions available if saving the assignment fails', async () => {
    global.fetch = jest.fn((url, init) => init?.method === 'POST' ? Promise.resolve({ ok: false } as Response) : respond(body(['Ana']))) as typeof fetch;
    render(<AgentRecommendationPanel referralId="r1" mcId={null} zips={[]} canPersistAssignment />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Use Ana' })); });
    expect(screen.getByRole('button', { name: 'Suggested agent' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('describes the 15-mile out-of-state scope', async () => {
    global.fetch = jest.fn(() => respond({ ...body(['Ana', 'Ben']), inputs: { mcId: null, mcName: null, zips: ['80107'], bucket: 'AHA_OOS', radiusMiles: 15 } })) as typeof fetch;
    render(<AgentRecommendationPanel referralId="r1" mcId={null} zips={['80107']} />);
    await flush();
    expect(await screen.findByText(/licensed in the destination state with closed-deal or coverage ZIPs within 15 miles of 80107/)).toBeInTheDocument();
    expect(screen.getByText(/Exact closed-deal ZIP matches come first/)).toBeInTheDocument();
    expect(screen.getByText(/ZIP success uses only past referrals with documented deal ZIPs matching these exact ZIPs/)).toBeInTheDocument();
  });

  it('refreshes when the MC or ZIP changes', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn((url: RequestInfo | URL) => {
      urls.push(String(url));
      return respond(body(['Ana', 'Ben', 'Cy']));
    }) as typeof fetch;
    const { rerender } = render(<AgentRecommendationPanel referralId="r1" mcId="mc" zips={['80014']} />);
    await flush();
    rerender(<AgentRecommendationPanel referralId="r1" mcId="mc-2" zips={['80014']} />);
    await flush();
    rerender(<AgentRecommendationPanel referralId="r1" mcId="mc-2" zips={['80202', '80014']} />);
    await flush();
    expect(urls).toEqual([
      '/api/referrals/r1/agent-recommendations?mcId=mc&zips=80014',
      '/api/referrals/r1/agent-recommendations?mcId=mc-2&zips=80014',
      '/api/referrals/r1/agent-recommendations?mcId=mc-2&zips=80202%2C80014',
    ]);
  });

  it('keeps an override local and labeled as not assigned', async () => {
    const fetchMock = jest.fn(() => respond(body(['Ana', 'Ben', 'Cy', 'Dee'])));
    global.fetch = fetchMock as typeof fetch;
    render(<AgentRecommendationPanel referralId="r1" mcId="mc" zips={['80014']} />);
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another agent' }));
    fireEvent.change(screen.getByLabelText('Preview a different agent'), { target: { value: 'id-Dee' } });
    expect(screen.getByText('Preview selection — not assigned.')).toBeInTheDocument();
    expect(screen.getAllByText('Dee').length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every((call) => !(call as unknown[])[1] || ((call as unknown[])[1] as RequestInit).method === undefined)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Preview selection — not assigned.')).not.toBeInTheDocument();
  });

  it('drops an override that is no longer eligible after a refresh', async () => {
    let names = ['Ana', 'Ben', 'Cy', 'Dee'];
    global.fetch = jest.fn(() => respond(body(names))) as typeof fetch;
    const { rerender } = render(<AgentRecommendationPanel referralId="r1" mcId="mc" zips={['80014']} />);
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: 'Choose another agent' }));
    fireEvent.change(screen.getByLabelText('Preview a different agent'), { target: { value: 'id-Dee' } });
    names = ['Ana', 'Ben', 'Cy'];
    rerender(<AgentRecommendationPanel referralId="r1" mcId="mc" zips={['80202']} />);
    await flush();
    await waitFor(() => expect(screen.queryByText('Preview selection — not assigned.')).not.toBeInTheDocument());
  });

  it('renders nothing for viewers without access', async () => {
    global.fetch = jest.fn(() => respond({ ...body([]), state: 'denied' })) as typeof fetch;
    const { container } = render(<AgentRecommendationPanel referralId="r1" mcId={null} zips={[]} />);
    await flush();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('explains a provisional suggestion when every agent has limited history', async () => {
    global.fetch = jest.fn(() => respond(body(['Ana', 'Ben'], { provisional: true }))) as typeof fetch;
    render(<AgentRecommendationPanel referralId="r1" mcId="mc" zips={['80014']} />);
    await flush();
    expect(await screen.findByText(/Provisional suggestion — every eligible agent has limited history/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose another agent' })).not.toBeInTheDocument();
  });
});
