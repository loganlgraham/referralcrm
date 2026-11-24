/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/referrals/[id]/agent-recommendations/route';
import { getCurrentSession } from '@/lib/auth';
import { authorizeFubViewer } from '@/lib/server/intelligence-viewer';
import { buildAgentRecommendations } from '@/lib/server/agent-recommendations';

jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn(async () => undefined) }));
jest.mock('@/lib/server/intelligence-viewer', () => ({ authorizeFubViewer: jest.fn() }));
jest.mock('@/lib/server/agent-recommendations', () => {
  const actual = jest.requireActual('@/lib/server/agent-recommendations');
  return { ...actual, buildAgentRecommendations: jest.fn(async () => ({ state: 'ready', officialScoring: false })) };
});
jest.mock('@/models/referral', () => ({
  Referral: {
    findById: jest.fn(() => ({
      select: () => ({ populate: () => ({ lean: async () => ({ _id: '6afe0df9ac60a148a3db2650', org: 'AFC', buySideAgent: { ahaDesignation: 'AHA' }, lookingInZip: '80014', deletedAt: null }) }) }),
    })),
  },
}));

const REFERRAL_ID = '6afe0df9ac60a148a3db2650';
const session = getCurrentSession as jest.Mock;
const viewer = authorizeFubViewer as jest.Mock;
const build = buildAgentRecommendations as jest.Mock;

function request(query = '', fetchSite = 'same-origin'): NextRequest {
  return new NextRequest(`https://preview.example.com/api/referrals/${REFERRAL_ID}/agent-recommendations${query}`, {
    headers: { 'sec-fetch-site': fetchSite },
  });
}

describe('agent recommendation route', () => {
  const originalAccount = process.env.REFERRIO_FUB_ACCOUNT_ID;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.REFERRIO_FUB_ACCOUNT_ID = '1846967076';
    session.mockResolvedValue({ user: { id: 'u1', role: 'admin' } });
  });
  afterAll(() => {
    process.env.REFERRIO_FUB_ACCOUNT_ID = originalAccount;
  });

  it('rejects cross-site and anonymous requests', async () => {
    expect((await GET(request('', 'cross-site'), { params: { id: REFERRAL_ID } })).status).toBe(403);
    session.mockResolvedValue(null);
    expect((await GET(request(), { params: { id: REFERRAL_ID } })).status).toBe(401);
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects viewers whose stored role is not admin or manager, even if the session claims admin', async () => {
    viewer.mockResolvedValue({ access: { ok: false, status: 403, reason: 'role' }, userId: 'u1', role: 'agent' });
    const response = await GET(request(), { params: { id: REFERRAL_ID } });
    expect(response.status).toBe(403);
    expect(build).not.toHaveBeenCalled();
  });

  it('gives admins without a Follow Up Boss grant Referrio-only suggestions', async () => {
    viewer.mockResolvedValue({ access: { ok: false, status: 403, reason: 'unmapped' }, userId: 'u1', role: 'admin' });
    const response = await GET(request('?mcId=none&zips=80014,bad'), { params: { id: REFERRAL_ID } });
    expect(response.status).toBe(200);
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ referral: expect.objectContaining({ org: 'AHA', ahaBucket: 'AHA' }), fubPermitted: false, mcOverride: null, zipOverride: ['80014'] }));
  });

  it('allows stored activity only for a granted viewer on the verified account', async () => {
    viewer.mockResolvedValue({ access: { ok: true }, userId: 'u1', role: 'admin' });
    await GET(request(), { params: { id: REFERRAL_ID } });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ fubPermitted: true }));
    process.env.REFERRIO_FUB_ACCOUNT_ID = '999';
    await GET(request(), { params: { id: REFERRAL_ID } });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ fubPermitted: false }));
  });
});
