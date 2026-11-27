/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/dashboard/fub/route';
import { getCurrentSession } from '@/lib/auth';
import { canViewFubDashboard } from '@/lib/server/fub-access';
import { fetchSopDashboard } from '@/lib/intelligence/sop-remote';
import { readFirstCallReport } from '@/lib/server/fub-first-call-report';
import { readDay31Decisions } from '@/lib/server/fub-sop-decisions';
import { fubDashboardFixture } from '../fixtures/fub-dashboard';
import { fubSopFixture, sopReviews } from '../fixtures/fub-sop';

jest.mock('@/lib/server/fub-first-call-report', () => ({ readFirstCallReport: jest.fn() }));
jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn() }));
jest.mock('@/lib/server/fub-access', () => ({ canViewFubDashboard: jest.fn() }));
jest.mock('@/lib/intelligence/sop-remote', () => ({ fetchSopDashboard: jest.fn() }));
jest.mock('@/lib/server/fub-sop-decisions', () => ({ readDay31Decisions: jest.fn() }));
const request = (query = '') => new NextRequest(`https://referrio.app/api/dashboard/fub${query}`);
beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.REFERRIO_SOP_SECRET;
  process.env.REFERRIO_FUB_ACCOUNT_ID = '1846967076';
  process.env.REFERRIO_INTELLIGENCE_URL = 'https://fub-intelligence-agent.vercel.app/api/integration/referrio/customer';
  process.env.REFERRIO_INTEGRATION_SECRET = 'test-only-secret';
  (getCurrentSession as jest.Mock).mockResolvedValue({ user: { id: 'test-admin' } });
  (canViewFubDashboard as jest.Mock).mockResolvedValue(false);
  (fetchSopDashboard as jest.Mock).mockResolvedValue(fubDashboardFixture);
  (readDay31Decisions as jest.Mock).mockResolvedValue([]);
});
test('denies ungranted and unsigned users without requesting remote evidence', async () => {
  expect((await GET(request())).status).toBe(403);
  (getCurrentSession as jest.Mock).mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(fetchSopDashboard).not.toHaveBeenCalled();
});
test('access discovery checks stored authority without reading evidence', async () => {
  const response = await GET(request('?access=1'));
  expect(await response.json()).toEqual({ allowed: false });
  expect(canViewFubDashboard).toHaveBeenCalledWith('test-admin');
  expect(fetchSopDashboard).not.toHaveBeenCalled();
});
test('validates the range and returns only private evidence for an authorized user', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  expect((await GET(request('?days=100'))).status).toBe(400);
  expect(fetchSopDashboard).not.toHaveBeenCalled();
  const response = await GET(request('?days=30'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual(fubDashboardFixture);
});

test('separates missing connection settings from permission and never fetches unconfigured evidence', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  delete process.env.REFERRIO_FUB_ACCOUNT_ID;
  const access = await GET(request('?access=1'));
  expect(await access.json()).toEqual({ allowed: true, configured: false });
  expect((await GET(request())).status).toBe(503);
  expect(fetchSopDashboard).not.toHaveBeenCalled();
});

test('uses a dashboard-only secret without requiring the broader integration credential', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  delete process.env.REFERRIO_INTEGRATION_SECRET;
  process.env.REFERRIO_SOP_SECRET = 'dashboard-only';
  expect((await GET(request())).status).toBe(200);
  expect(fetchSopDashboard).toHaveBeenCalledWith(expect.objectContaining({ secret: 'dashboard-only' }));
});

test('loads decisions only for authoritative Day 31 notes and rechecks permission after reading remote evidence', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  const { day31Decisions, ...dashboard } = fubSopFixture;
  (fetchSopDashboard as jest.Mock).mockResolvedValue(dashboard);
  (readDay31Decisions as jest.Mock).mockResolvedValue(day31Decisions);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(fubSopFixture);
  expect(readDay31Decisions).toHaveBeenCalledWith(sopReviews.filter((review) => review.kind === 'day-31'));
  expect(canViewFubDashboard).toHaveBeenCalledTimes(3);
  expect(response.headers.get('cache-control')).toContain('no-store');
});

test('a revoked grant blocks local decision reads after the remote dashboard request completes', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  (fetchSopDashboard as jest.Mock).mockResolvedValue(fubSopFixture);
  const response = await GET(request());
  expect(response.status).toBe(403);
  expect(readDay31Decisions).not.toHaveBeenCalled();
  expect(await response.json()).not.toHaveProperty('sopAudits');
});

test('a decision store failure preserves SOP evidence but never presents an empty decision set as success', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  const { day31Decisions: _decisions, ...dashboard } = fubSopFixture;
  (fetchSopDashboard as jest.Mock).mockResolvedValue(dashboard);
  (readDay31Decisions as jest.Mock).mockRejectedValue(new Error('private database failure'));
  const response = await GET(request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.sopAudits).toEqual(sopReviews);
  expect(body.decisionError).toMatch(/could not be loaded/);
  expect(body).not.toHaveProperty('day31Decisions');
  expect(JSON.stringify(body)).not.toContain('private database failure');
});

test('upstream unavailability returns 503 without reading or fabricating local decisions', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  (fetchSopDashboard as jest.Mock).mockResolvedValue(null);
  expect((await GET(request())).status).toBe(503);
  expect(readDay31Decisions).not.toHaveBeenCalled();
});

test('an unavailable clock feed does not erase existing reminders or return zero handoffs', async () => {
  (canViewFubDashboard as jest.Mock).mockResolvedValue(true);
  (readFirstCallReport as jest.Mock).mockRejectedValue(new Error('unavailable'));
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...fubDashboardFixture, firstCallReport: null });
});
