/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/dashboard/fub/decisions/route';
import { getCurrentSession } from '@/lib/auth';
import { canViewFubDashboard } from '@/lib/server/fub-access';
import { fetchSopReview } from '@/lib/intelligence/sop-remote';
import { readDay31Decisions, saveDay31Decision } from '@/lib/server/fub-sop-decisions';

jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn() }));
jest.mock('@/lib/server/fub-access', () => ({ canViewFubDashboard: jest.fn() }));
jest.mock('@/lib/intelligence/sop-remote', () => ({ fetchSopReview: jest.fn() }));
jest.mock('@/lib/server/fub-sop-decisions', () => ({ readDay31Decisions: jest.fn(), saveDay31Decision: jest.fn() }));

const REVIEWER = '6740aabbccddeeff00112233';
const REVIEW_ID = 'tag:11111111-1111-4111-8111-111111111111';
const REVIEW = { id: REVIEW_ID, kind: 'day-31', personId: 75, customer: 'Example Customer', agentId: 2, at: '2026-11-01T12:00:00.000Z', sourceNoteId: null, provenance: 'tag_observation' };
const BODY = { personId: 75, reviewId: REVIEW_ID, decision: 'keep', reason: 'Client plans a spring move.', expectedRevision: 0, requestId: '66666666-1111-4111-8111-111111111111' };
const post = (body: unknown = BODY, origin = 'https://referrio.app') => new NextRequest('https://referrio.app/api/dashboard/fub/decisions', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const get = (query = `?personId=75&reviewId=${REVIEW_ID}`) => new NextRequest(`https://referrio.app/api/dashboard/fub/decisions${query}`, { headers: { 'sec-fetch-site': 'same-origin' } });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REFERRIO_FUB_ACCOUNT_ID = '1846967076';
  process.env.REFERRIO_INTELLIGENCE_URL = 'https://fub-intelligence-agent.vercel.app/api/integration/referrio/customer';
  process.env.REFERRIO_SOP_SECRET = 'test-dashboard-secret';
  (getCurrentSession as jest.Mock).mockResolvedValue({ user: { id: REVIEWER, name: 'Untrusted stale session name' } });
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  (fetchSopReview as jest.Mock).mockResolvedValue(REVIEW);
  (readDay31Decisions as jest.Mock).mockResolvedValue([]);
  (saveDay31Decision as jest.Mock).mockResolvedValue({ ok: true, changed: true, record: { revision: 1 } });
});

test('rejects cross-site, unsigned, and ungranted writes before requesting evidence', async () => {
  expect((await POST(post(BODY, 'https://attacker.example'))).status).toBe(403);
  (getCurrentSession as jest.Mock).mockResolvedValue(null);
  expect((await POST(post())).status).toBe(401);
  (getCurrentSession as jest.Mock).mockResolvedValue({ user: { id: REVIEWER } });
  (canViewFubDashboard as jest.Mock).mockResolvedValue(false);
  expect((await POST(post())).status).toBe(403);
  expect(fetchSopReview).not.toHaveBeenCalled();
  expect(saveDay31Decision).not.toHaveBeenCalled();
});

test('validates explicit input and does not accept client reviewer identity', async () => {
  expect((await POST(post({ ...BODY, reason: ' ' }))).status).toBe(400);
  expect((await POST(post({ ...BODY, reviewerId: 'forged' }))).status).toBe(400);
  expect(saveDay31Decision).not.toHaveBeenCalled();
});

test('binds the exact eligible Day 31 source review before saving', async () => {
  for (const review of [null, { ...REVIEW, kind: 'day-3' }, { ...REVIEW, personId: 76 }, { ...REVIEW, id: 'tag:22222222-2222-4222-8222-222222222222' }]) {
    (fetchSopReview as jest.Mock).mockResolvedValue(review);
    expect((await POST(post())).status).toBe(404);
  }
  expect(saveDay31Decision).not.toHaveBeenCalled();
});

test('rechecks a revoked grant after the remote evidence read', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await POST(post())).status).toBe(403);
  expect(fetchSopReview).toHaveBeenCalledTimes(1);
  expect(saveDay31Decision).not.toHaveBeenCalled();
});

test('saves with server session identity and returns private data', async () => {
  const response = await POST(post());
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(fetchSopReview).toHaveBeenCalledWith(expect.objectContaining({ personId: 75, reviewId: REVIEW_ID, accountId: '1846967076', secret: 'test-dashboard-secret' }));
  expect(saveDay31Decision).toHaveBeenCalledWith({ command: BODY, origin: REVIEW, reviewerId: REVIEWER });
  expect(canViewFubDashboard).toHaveBeenCalledTimes(2);
});

test('returns conflict for stale edits and fails closed on missing connection or backend errors', async () => {
  (saveDay31Decision as jest.Mock).mockResolvedValue({ ok: false, status: 409, reason: 'conflict' });
  expect((await POST(post())).status).toBe(409);
  (fetchSopReview as jest.Mock).mockRejectedValue(new Error('upstream unavailable'));
  expect((await POST(post())).status).toBe(503);
  delete process.env.REFERRIO_FUB_ACCOUNT_ID;
  expect((await POST(post())).status).toBe(503);
});

test('reads only decisions tied to the verified review and rejects invalid IDs', async () => {
  expect((await GET(get('?personId=75&reviewId=note:0'))).status).toBe(400);
  expect((await POST(post({ ...BODY, reviewId: 'tag:day31' }))).status).toBe(400);
  const response = await GET(get());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ record: null });
  expect(readDay31Decisions).toHaveBeenCalledWith([REVIEW]);
  expect(response.headers.get('cache-control')).toContain('no-store');
});
