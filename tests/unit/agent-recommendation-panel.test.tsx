import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    evidenceStrength: rank === 1 ? 'Strong' : 'Limited',
    coversZip: false,
    factors: { mc: rate, zip: rate, overall: rate, usedAfc: rate, workload: { active: 2, poolMedian: 2, points: 50 } },
    excludedOutcomes: 0,
    fub: { state: 'neutral', reason: 'not_linked' },
    reasons: [`${name} reason one`, `${name} reason two`, `${name} reason three`],
  };
}

function body(names: string[]): AgentRecommendationResponse {
  return {
    officialScoring: false,
    preview: true,
    policyVersion: 'test',
    state: 'ready',
    generatedAt: '2026-11-19T20:00:00.000Z',
    inputs: { mcId: 'mc', mcName: 'Karim L', zips: ['80014'], bucket: 'AHA' },
    recommendations: names.map((name, index) => rec(`id-${name}`, name, index + 1)),
    totals: { eligible: names.length, inactive: 0, noZipCoverage: 0, windowStart: '2024-11-19T20:00:00.000Z', resolvedOutcomes: 4, activeOutcomes: 0, excludedOutcomes: 0 },
    baselines: { overall: 0.3, mc: 0.3, zip: 0.3, usedAfc: 0.8 },
    workloadMedian: 2,
    fub: { state: 'not_permitted', linkedAgents: 0, adjustedAgents: 0 },
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

  it('shows one suggestion, three reasons, two alternatives, and no assign or send action', async () => {
    global.fetch = jest.fn(() => respond(body(['Ana', 'Ben', 'Cy', 'Dee']))) as typeof fetch;
    render(<AgentRecommendationPanel referralId="r1" mcId="mc" zips={['80014']} />);
    await flush();
    expect((await screen.findAllByText('Ana')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ana reason/)).toHaveLength(3);
    expect(screen.queryAllByText(/Ben reason/)).toHaveLength(0);
    const alternatives = screen.getByText('Alternatives').parentElement as HTMLElement;
    expect(alternatives).toHaveTextContent('Ben');
    expect(alternatives).toHaveTextContent('Cy');
    expect(screen.queryByText('Dee')).not.toBeInTheDocument();
    expect(screen.getByText('Strong evidence')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign|send|follow up boss/i })).not.toBeInTheDocument();
    expect(screen.getByText('How this was calculated')).toBeInTheDocument();
    expect(screen.getByText(/Uses Referrio data only/)).toBeInTheDocument();
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
});
