/** @jest-environment node */
import { createHmac } from 'node:crypto';
import { fetchSopDashboard, fetchSopReview } from '@/lib/intelligence/sop-remote';
import { fubDashboardFixture } from '../fixtures/fub-dashboard';
import { fubSopFixture, sopReviews } from '../fixtures/fub-sop';

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

const reviewInput = { ...input, personId: 3001, sourceNoteId: 901 };
test('signs an exact Day 31 source review with a separate purpose and no dashboard date window', async () => {
  const review = { ...sopReviews[5], provenance: 'automation' };
  const fetchImpl = jest.fn(async () => Response.json({ review }));
  expect(await fetchSopReview({ ...reviewInput, fetchImpl })).toEqual(review);
  const [url, options] = (fetchImpl.mock.calls as unknown as [string, RequestInit][])[0];
  expect(url).toBe('https://fub-intelligence-agent.vercel.app/api/integration/referrio/sop/review');
  expect(options).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' });
  const body = JSON.parse(options.body as string);
  expect(body).toEqual({ organization: 'AHA', accountId: input.accountId, personId: 3001, sourceNoteId: 901, exp: expect.any(Number) });
  expect(options.headers).toMatchObject({
    'x-referrio-signature': createHmac('sha256', input.secret)
      .update(`referrio-sop-review-v1\nAHA\n${input.accountId}\n3001\n901\n${body.exp}`).digest('hex'),
  });
});

test('only an authoritative 404 means a review is absent; unavailable and malformed responses throw', async () => {
  const fetchImpl = jest.fn(async () => Response.json({}, { status: 404 }));
  expect(await fetchSopReview({ ...reviewInput, fetchImpl })).toBeNull();
  fetchImpl.mockImplementation(async () => Response.json({}, { status: 503 }));
  await expect(fetchSopReview({ ...reviewInput, fetchImpl })).rejects.toThrow();
  fetchImpl.mockImplementation(async () => Response.json({ review: null }));
  await expect(fetchSopReview({ ...reviewInput, fetchImpl })).rejects.toThrow();
  fetchImpl.mockImplementation(async () => { throw new Error('network unavailable'); });
  await expect(fetchSopReview({ ...reviewInput, fetchImpl })).rejects.toThrow();
});

test.each([
  { ...sopReviews[5], personId: 3002 },
  { ...sopReviews[5], id: 'note:902', sourceNoteId: 902 },
  { ...sopReviews[5], id: 'note:999' },
  { ...sopReviews[5], kind: 'day-3' },
  { ...sopReviews[5], at: 'invalid date' },
])('rejects a mismatched source review %#', async (review) => {
  const fetchImpl = jest.fn(async () => Response.json({ review }));
  await expect(fetchSopReview({ ...reviewInput, fetchImpl })).rejects.toThrow();
});

test('does not send signed review credentials to an untrusted destination or invalid source identity', async () => {
  const fetchImpl = jest.fn(async () => Response.json({ review: sopReviews[5] }));
  await expect(fetchSopReview({ ...reviewInput, url: 'https://example.com/other', fetchImpl })).rejects.toThrow();
  await expect(fetchSopReview({ ...reviewInput, personId: -1, fetchImpl })).rejects.toThrow();
  await expect(fetchSopReview({ ...reviewInput, sourceNoteId: Number.MAX_SAFE_INTEGER + 1, fetchImpl })).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('accepts additive SOP evidence without weakening the legacy or audit identity contract', async () => {
  const { day31Decisions: _decisions, ...dashboard } = fubSopFixture;
  const fetchImpl = jest.fn(async () => Response.json(dashboard));
  expect(await fetchSopDashboard({ ...input, fetchImpl })).toEqual(dashboard);
  fetchImpl.mockImplementation(async () => Response.json({ ...dashboard, sopAudits: [{ ...sopReviews[0], id: 'note:999' }] }));
  expect(await fetchSopDashboard({ ...input, fetchImpl })).toBeNull();
});
