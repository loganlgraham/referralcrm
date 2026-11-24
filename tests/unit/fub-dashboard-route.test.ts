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
