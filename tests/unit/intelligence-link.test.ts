import { readFileSync } from 'node:fs';
import { agentsDiffer, authorizeIntelligencePanel, participantBelongsToReferral, reviewIdentitySuggestion, sameOriginRequest } from '@/lib/intelligence/panel';
import { createMemoryLinks, setAgentLink, setCustomerLink } from '@/lib/intelligence/links';
import { clearIntelligenceCache, fetchCustomerIntelligence, trustedIntelligenceUrl } from '@/lib/intelligence/remote';

const base = {
  organization: 'AHA' as const,
  fubAccountId: 'fub-aha',
  actorId: 'user-1',
  at: '2026-11-18T17:00:00.000Z',
};

describe('explicit intelligence links', () => {
  it('keeps an ambiguous suggestion unlinked and allows many referrals for one person', () => {
    expect(reviewIdentitySuggestion([])).toEqual({ status: 'unlinked', reason: 'none' });
    expect(reviewIdentitySuggestion([
      { personId: 1, name: 'Casey', email: 'a@example.com' },
      { personId: 2, name: 'Casey', email: 'b@example.com' },
    ])).toEqual({ status: 'unlinked', reason: 'ambiguous' });
    const repo = createMemoryLinks();
    const first = setCustomerLink(repo, { ...base, referralId: 'ref-1', participantKey: 'borrower', personId: 100 });
    const second = setCustomerLink(repo, { ...base, referralId: 'ref-2', participantKey: 'borrower', personId: 100 });
    const extra = setCustomerLink(repo, { ...base, referralId: 'ref-1', participantKey: 'participant:coborrower', personId: 200 });
    expect(first.ok && second.ok && extra.ok).toBe(true);
    expect(repo.customers).toHaveLength(3);
    const corrected = setCustomerLink(repo, { ...base, referralId: 'ref-1', participantKey: 'borrower', personId: 101, actorId: 'manager-2' });
    expect(corrected.ok && corrected.link.audit[1]).toMatchObject({ action: 'correct', previousPersonId: 100, nextPersonId: 101 });
    const cleared = setCustomerLink(repo, { ...base, referralId: 'ref-1', participantKey: 'borrower', personId: null });
    expect(cleared.ok && cleared.link.fubPersonId).toBeNull();
    expect(setCustomerLink(repo, { ...base, referralId: 'ref-1', participantKey: 'borrower', personId: 'casey@example.com' }).ok).toBe(false);
  });

  it('maps an agent without changing the stored person link', () => {
    const repo = createMemoryLinks();
    setCustomerLink(repo, { ...base, referralId: 'ref-1', participantKey: 'borrower', personId: 100 });
    const agent = setAgentLink(repo, { ...base, agentId: 'agent-1', fubUserId: 13 });
    expect(agent.ok && agent.link.fubUserId).toBe(13);
    expect(repo.customers[0]?.fubPersonId).toBe(100);
    expect(agentsDiffer('Sherri Elmore', 'Jessica Creasey', 13, 14)).toBe(true);
    expect(agentsDiffer('Sherri Elmore', 'Sherri Elmore', 13, 13)).toBe(false);
  });

  it('requires an explicit manager grant and the referral organization', () => {
    const grant = { organization: 'AHA' as const, fubAccountId: 'fub-aha', userId: 'manager-1' };
    expect(authorizeIntelligencePanel({
      userId: 'manager-1', role: 'manager', canViewReferral: true, referralOrg: 'AHA', grant, configuredAccountId: 'fub-aha',
    }).ok).toBe(true);
    expect(authorizeIntelligencePanel({
      userId: 'agent-1', role: 'agent', canViewReferral: true, referralOrg: 'AHA', grant: { ...grant, userId: 'agent-1' }, configuredAccountId: 'fub-aha',
    }).reason).toBe('role');
    expect(authorizeIntelligencePanel({
      userId: 'manager-1', role: 'admin', canViewReferral: true, referralOrg: 'AHA', grant: null, configuredAccountId: 'fub-aha',
    }).reason).toBe('unmapped');
    expect(authorizeIntelligencePanel({
      userId: 'manager-1', role: 'admin', canViewReferral: true, referralOrg: 'AFC', grant, configuredAccountId: 'fub-aha',
    }).reason).toBe('wrong_organization');
    expect(authorizeIntelligencePanel({
      userId: 'manager-1', role: 'manager', canViewReferral: false, referralOrg: 'AHA', grant, configuredAccountId: 'fub-aha',
    }).reason).toBe('referral');
    expect(authorizeIntelligencePanel({
      userId: 'viewer-1', role: 'viewer', canViewReferral: true, referralOrg: 'AHA', grant: { ...grant, userId: 'viewer-1' }, configuredAccountId: 'fub-aha',
    }).reason).toBe('role');
    expect(participantBelongsToReferral('borrower', ['borrower'])).toBe(true);
    expect(participantBelongsToReferral('participant:coborrower', ['borrower'])).toBe(false);
    expect(sameOriginRequest({ requestOrigin: 'https://referrio.app', pageOrigin: 'https://referrio.app', fetchSite: null })).toBe(true);
    expect(sameOriginRequest({ requestOrigin: 'https://evil.example', pageOrigin: 'https://referrio.app', fetchSite: 'cross-site' })).toBe(false);
    expect(sameOriginRequest({ requestOrigin: null, pageOrigin: 'https://referrio.app', fetchSite: null })).toBe(false);
  });
});

describe('intelligence reads', () => {
  beforeEach(() => clearIntelligenceCache());

  it('rejects a tampered person id and a timeout without calling Follow Up Boss', async () => {
    const calls: string[] = [];
    const tampered = await fetchCustomerIntelligence({
      organization: 'AHA',
      fubAccountId: 'fub-aha',
      referralId: 'ref-1',
      participantKey: 'borrower',
      personId: 100,
      secret: 'secret',
      url: 'https://intelligence.example/api/integration/referrio/customer',
      now: 1_795_000_000_000,
      fetchImpl: async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ state: 'ready', officialScoring: false, personId: 999 }),
        } as Response;
      },
    });
    expect(tampered).toEqual({ state: 'unavailable', reason: 'tampered_person' });
    expect(calls).toEqual(['https://intelligence.example/api/integration/referrio/customer']);
    const timedOut = await fetchCustomerIntelligence({
      organization: 'AHA',
      fubAccountId: 'fub-aha',
      referralId: 'ref-1',
      participantKey: 'borrower',
      personId: 100,
      secret: 'secret',
      url: 'https://intelligence.example/api/integration/referrio/customer',
      fetchImpl: async () => {
        throw new Error('timeout');
      },
    });
    expect(timedOut).toEqual({ state: 'unavailable', reason: 'timeout' });
    const callsForCache: string[] = [];
    const read = async (url: string | URL | Request) => {
      callsForCache.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          state: 'ready',
          officialScoring: false,
          personId: 100,
          latest: null,
          followUp: null,
          fubAssignedUser: null,
          projectedClosings: [],
          freshness: { readAt: '2026-11-18T17:00:00.000Z', note: 'Stored read.' },
          detailPath: '/intelligence/leads/100',
        }),
      } as Response;
    };
    const input = {
      organization: 'AHA',
      fubAccountId: 'fub-aha',
      referralId: 'ref-1',
      participantKey: 'borrower',
      personId: 100,
      secret: 'secret',
      url: 'https://intelligence.example/api/integration/referrio/customer',
      now: 1_795_000_000_000,
      fetchImpl: read,
    };
    await fetchCustomerIntelligence(input);
    await fetchCustomerIntelligence(input);
    await fetchCustomerIntelligence({ ...input, personId: 101, referralId: 'ref-2' });
    expect(callsForCache).toHaveLength(2);
    expect(callsForCache[1]).toBe('https://intelligence.example/api/integration/referrio/customer');
    const blocked = await fetchCustomerIntelligence({ ...input, url: 'http://intelligence.example/api/integration/referrio/customer', fetchImpl: read });
    expect(blocked).toEqual({ state: 'unavailable', reason: 'not_configured' });
    expect(trustedIntelligenceUrl('https://intelligence.example/api/integration/referrio/customer?next=https://evil.example')).toBeNull();
    expect(callsForCache).toHaveLength(2);
  });

  it('does not fetch email, call a model, or change referral financial records from the route', () => {
    const route = readFileSync('src/app/api/referrals/[id]/intelligence/route.ts', 'utf8');
    const remote = readFileSync('src/lib/intelligence/remote.ts', 'utf8');
    for (const source of [route, remote]) {
      expect(source.includes('api.followupboss.com')).toBe(false);
      expect(source.includes('api.openai.com')).toBe(false);
    }
    expect(route.includes('Payment')).toBe(false);
    expect(route.includes('.save(')).toBe(false);
    expect(route.includes('buyStatus')).toBe(false);
    expect(route.includes('expectedAmountCents')).toBe(false);
    expect(route.includes('INTELLIGENCE_APP_ORIGIN')).toBe(false);
    expect(route.includes('detailHref')).toBe(false);
    const panel = readFileSync('src/components/referrals/intelligence-panel.tsx', 'utf8');
    expect(panel.includes('REFERRIO_INTEGRATION_SECRET')).toBe(false);
    expect(panel.includes('SUPABASE_SECRET_KEY')).toBe(false);
    expect(panel.includes('detailHref')).toBe(false);
  });
});
