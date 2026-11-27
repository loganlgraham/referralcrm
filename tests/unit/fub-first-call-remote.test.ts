/** @jest-environment node */
import { createHmac } from 'node:crypto';
import { readFirstCallReport } from '@/lib/server/fub-first-call-report';
import { readConfirmedHandoffs } from '@/lib/server/fub-confirmed-handoffs';
jest.mock('@/lib/server/fub-confirmed-handoffs', () => ({ readConfirmedHandoffs: jest.fn() }));
jest.mock('@/lib/intelligence/remote', () => ({ trustedIntelligenceUrl: (url: string) => url, resolveProtectionToken: async () => null }));
test('sends the confirmed agent IDs and observation window inside the signed request', async () => {
  const originalFetch = global.fetch;
  const readAt = '2026-11-25T17:30:00Z';
  const handoffs = [{ personId: 111, agentId: 9, at: readAt, beganAt: readAt }];
  (readConfirmedHandoffs as jest.Mock).mockResolvedValue(handoffs);
  process.env.REFERRIO_INTELLIGENCE_URL = 'https://example.test/api/integration/referrio/customer';
  process.env.REFERRIO_SOP_SECRET = 'test-secret';
  process.env.REFERRIO_FUB_ACCOUNT_ID = '1846967076';
  const send = jest.fn(async () => new Response(JSON.stringify({ readAt, rows: [] })));
  global.fetch = send;
  try {
    await expect(readFirstCallReport(7, readAt)).resolves.toEqual({ readAt, rows: [] });
    expect(readConfirmedHandoffs).toHaveBeenCalledWith(7,readAt);
    const [url, options] = (send.mock.calls as unknown as [URL, RequestInit][])[0];
    expect(url.pathname).toBe('/api/integration/referrio/first-calls');
    const body = String(options.body);
    expect(JSON.parse(body)).toEqual(expect.objectContaining({ handoffs, days:7, readAt, organization:'AHA' }));
    expect(options.headers).toEqual(expect.objectContaining({
      'x-referrio-signature':createHmac('sha256','test-secret').update('referrio-first-calls-v1\n').update(body).digest('hex'),
    }));
  } finally {
    global.fetch = originalFetch;
  }
});
