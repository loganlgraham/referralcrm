import { createHmac } from 'node:crypto';
import { agentActivityUrl, canonicalAgentActivity, fetchStoredAgentActivity } from '@/lib/intelligence/agent-activity';

const CUSTOMER_URL = 'https://intelligence.example.com/api/integration/referrio/customer';

function respond(status: number, value: unknown): Promise<Response> {
  return Promise.resolve({ ok: status < 400, status, json: async () => value } as Response);
}

const base = {
  organization: 'AHA',
  fubAccountId: '1846967076',
  referralId: 'ref-1',
  secret: 'test-secret',
  customerUrl: CUSTOMER_URL,
  now: 1_800_000_000_000,
  protectionToken: null,
};

describe('stored agent activity read', () => {
  it('only targets the reviewed Intelligence host', () => {
    expect(agentActivityUrl(CUSTOMER_URL)).toBe('https://intelligence.example.com/api/integration/referrio/agent-activity');
    expect(agentActivityUrl('https://intelligence.example.com/other')).toBeNull();
    expect(agentActivityUrl('http://intelligence.example.com/api/integration/referrio/customer')).toBeNull();
  });

  it('signs the exact user list and does not call out without links', async () => {
    const fetchImpl = jest.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body));
      const expected = createHmac('sha256', 'test-secret').update(canonicalAgentActivity(sent)).digest('hex');
      expect((init?.headers as Record<string, string>)['x-referrio-signature']).toBe(expected);
      expect(sent.fubUserIds).toEqual([7, 9]);
      return respond(200, { officialScoring: false, coverageComplete: true, users: [{ fubUserId: 7, state: 'measured', assignedPeople: 8, contactedPeople: 6 }] });
    });
    const result = await fetchStoredAgentActivity({ ...base, fubUserIds: [9, 7, 9], fetchImpl: fetchImpl as typeof fetch });
    expect(result).toEqual({ state: 'ready', coverageComplete: true, users: [{ fubUserId: 7, state: 'measured', assignedPeople: 8, contactedPeople: 6 }] });
    const none = jest.fn();
    expect(await fetchStoredAgentActivity({ ...base, fubUserIds: [], fetchImpl: none as unknown as typeof fetch })).toEqual({ state: 'ready', coverageComplete: false, users: [] });
    expect(none).not.toHaveBeenCalled();
  });

  it('falls back to Referrio-only on a missing endpoint, unrequested users, or a scored payload', async () => {
    expect(await fetchStoredAgentActivity({ ...base, fubUserIds: [7], fetchImpl: (() => respond(404, {})) as typeof fetch })).toEqual({ state: 'unavailable', reason: 'not_deployed' });
    expect(await fetchStoredAgentActivity({
      ...base,
      fubUserIds: [7],
      fetchImpl: (() => respond(200, { officialScoring: false, users: [{ fubUserId: 8, state: 'measured', assignedPeople: 1, contactedPeople: 1 }] })) as typeof fetch,
    })).toEqual({ state: 'unavailable', reason: 'tampered_user' });
    expect(await fetchStoredAgentActivity({ ...base, fubUserIds: [7], fetchImpl: (() => respond(200, { officialScoring: true, users: [] })) as typeof fetch })).toEqual({ state: 'unavailable', reason: 'malformed' });
    expect(await fetchStoredAgentActivity({ ...base, secret: '', fubUserIds: [7] })).toEqual({ state: 'unavailable', reason: 'not_configured' });
  });
});
