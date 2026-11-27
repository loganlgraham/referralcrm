/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/referrals/[id]/agent-recommendations/route';
import { Referral } from '@/models/referral';
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
    findById: jest.fn(),
  },
}));

const REFERRAL_ID = '6afe0df9ac60a148a3db2650';
const session = getCurrentSession as jest.Mock;
const viewer = authorizeFubViewer as jest.Mock;
const build = buildAgentRecommendations as jest.Mock;

function storedReferral(fields: Record<string, unknown>) {
  (Referral.findById as jest.Mock).mockReturnValue({
    select: () => ({ populate: () => ({ lean: async () => ({ _id: REFERRAL_ID, org: 'AFC', ...fields }) }) }),
  });
}

function request(query = '', fetchSite = 'same-origin'): NextRequest {
  return new NextRequest(`https://preview.example.com/api/referrals/${REFERRAL_ID}/agent-recommendations${query}`, {
    headers: { 'sec-fetch-site': fetchSite },
  });
}

describe('agent recommendation route', () => {
  const originalAccount = process.env.REFERRIO_FUB_ACCOUNT_ID;
  beforeEach(() => {
    jest.clearAllMocks();
    storedReferral({ buySideAgent: { ahaDesignation: 'AHA' }, lookingInZip: '80014' });
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

  it.each([
    [{ origin: 'admin', lookingInZip: '80014' }, 'AHA', 'AHA'],
    [{ origin: 'mc', lookingInZips: ['60601', '80014'] }, 'AHA', 'AHA_OOS'],
    [{ origin: 'admin' }, 'AHA', null],
    [{ inboundEmail: { channel: 'AHA_OOS' }, lookingInZip: '80014' }, 'AHA', 'AHA_OOS'],
    [{ inboundEmail: { channel: 'AHA' }, lookingInZip: '60601' }, 'AHA', 'AHA'],
    [{ inboundEmail: { channel: 'AHA' } }, 'AHA', 'AHA'],
    [{ assignedAgent: { ahaDesignation: 'AHA' }, lookingInZip: '60601' }, 'AHA', 'AHA'],
    [{ assignedAgent: { ahaDesignation: 'AGIT' }, lookingInZip: '80014' }, 'AFC', null],
    [{ origin: 'agent', lookingInZip: '80014' }, 'AFC', null],
  ])('uses the search area only before the first manual assignment (%j)', async (fields, org, ahaBucket) => {
    storedReferral(fields as Record<string, unknown>);
    viewer.mockResolvedValue({ access: { ok: false }, role: 'admin' });
    expect((await GET(request(), { params: { id: REFERRAL_ID } })).status).toBe(200);
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ referral: expect.objectContaining({ org, ahaBucket }), fubPermitted: false }));
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
