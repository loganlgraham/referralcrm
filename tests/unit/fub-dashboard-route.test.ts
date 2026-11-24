/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/dashboard/fub/route';
import { getCurrentSession } from '@/lib/auth';
import { canViewFubDashboard } from '@/lib/server/fub-access';
import { fetchSopDashboard } from '@/lib/intelligence/sop-remote';
import { fubDashboardFixture } from '../fixtures/fub-dashboard';

jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn() }));
jest.mock('@/lib/server/fub-access', () => ({ canViewFubDashboard: jest.fn() }));
jest.mock('@/lib/intelligence/sop-remote', () => ({ fetchSopDashboard: jest.fn() }));
const request = (query = '') => new NextRequest(`https://referrio.app/api/dashboard/fub${query}`);
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.REFERRIO_SOP_SECRET;
  process.env.REFERRIO_FUB_ACCOUNT_ID = '1846967076';
  process.env.REFERRIO_INTELLIGENCE_URL = 'https://fub-intelligence-agent.vercel.app/api/integration/referrio/customer';
  process.env.REFERRIO_INTEGRATION_SECRET = 'test-only-secret';
  (getCurrentSession as jest.Mock).mockResolvedValue({ user: { id: 'test-admin' } });
  (canViewFubDashboard as jest.Mock).mockResolvedValue(false);
  (fetchSopDashboard as jest.Mock).mockResolvedValue(fubDashboardFixture);
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
