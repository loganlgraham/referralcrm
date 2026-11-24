/** @jest-environment node */
import { createHmac } from 'node:crypto';
import { fetchSopDashboard } from '@/lib/intelligence/sop-remote';
import { fubDashboardFixture } from '../fixtures/fub-dashboard';

jest.mock('@vercel/functions/oidc', () => ({ getVercelOidcToken: jest.fn() }));

const input = {
  days: 30 as const,
  url: 'https://fub-intelligence-agent.vercel.app/api/integration/referrio/customer',
  accountId: '1846967076',
  secret: 'test-only-secret',
  protectionToken: null,
};
test('signs the account and time range and validates the stored-evidence response', async () => {
  const fetchImpl = jest.fn(async () => Response.json(fubDashboardFixture));
  expect(await fetchSopDashboard({ ...input, fetchImpl })).toEqual(fubDashboardFixture);
  const [url, options] = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0];
  expect(url).toBe('https://fub-intelligence-agent.vercel.app/api/integration/referrio/sop');
  expect(options.cache).toBe('no-store');
  expect(options.redirect).toBe('manual');
  const body = JSON.parse(options.body as string);
  expect(options.headers).toMatchObject({
    'x-referrio-signature': createHmac('sha256', input.secret)
      .update(`referrio-sop-v1\nAHA\n${input.accountId}\n30\n${body.exp}`).digest('hex'),
  });
});
test('fails closed on invalid destinations, upstream errors and mismatched evidence', async () => {
  const fetchImpl = jest.fn(async () => Response.json(fubDashboardFixture));
  expect(await fetchSopDashboard({ ...input, url: 'https://example.com/other', fetchImpl })).toBeNull();
  expect(fetchImpl).not.toHaveBeenCalled();
  fetchImpl.mockImplementation(async () => Response.json({ ...fubDashboardFixture, days: 7 }));
  expect(await fetchSopDashboard({ ...input, fetchImpl })).toBeNull();
  fetchImpl.mockImplementation(async () => Response.json({}, { status: 503 }));
  expect(await fetchSopDashboard({ ...input, fetchImpl })).toBeNull();
});
