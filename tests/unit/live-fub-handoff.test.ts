/** @jest-environment node */
import { getVercelOidcToken } from '@vercel/functions/oidc';

import { createLiveFubClient, getFubAgentChoices, readFubAutomations } from '@/lib/server/live-fub-handoff';

jest.mock('@vercel/functions/oidc', () => ({ getVercelOidcToken: jest.fn() }));
jest.mock('@/models/inbound-referral-message', () => ({ InboundReferralMessage: {} }));

const originalFetch = global.fetch;
const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    VERCEL_ENV: 'production',
    REFERRIO_FUB_ACCOUNT_ID: '1846967076',
    REFERRIO_INTELLIGENCE_URL: 'https://fub-intelligence-agent.vercel.app/api/integration/referrio/customer',
    REFERRIO_INTEGRATION_SECRET: 'test-only-secret',
  };
  (getVercelOidcToken as jest.Mock).mockResolvedValue(null);
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = originalEnv;
});

it('sends the OOS tag with assignment and requires confirmation from the integration service', async () => {
  global.fetch = jest.fn(async () => Response.json({ previousUserId: 71, assignedUserId: 72, tags: ['Existing', 'OOS Referral'] }));
  const input = { personId: 123, fubUserId: 72, tags: ['OOS Referral'], operationKey: 'assign' };
  await expect(createLiveFubClient(72).assignAgent(input)).resolves.toMatchObject({ tags: ['Existing', 'OOS Referral'] });
  const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
  expect(body).toMatchObject({ operation: 'assign_agent', input });
  global.fetch = jest.fn(async () => Response.json({ previousUserId: 71, assignedUserId: 72 }));
  await expect(createLiveFubClient(72).assignAgent(input)).rejects.toMatchObject({ code: 'fub_tags_unconfirmed', certainty: 'definitive' });
});

it('preserves an explicitly reported automation access restriction from the trusted service', async () => {
  global.fetch = jest.fn(async () => Response.json({
    code: 'fub_automations_restricted', error: 'Automation access is restricted.', uncertain: false,
  }, { status: 403 }));

  await expect(readFubAutomations(123, true)).rejects.toMatchObject({
    code: 'fub_automations_restricted', status: 403, certainty: 'definitive',
  });
});

it.each([
  { status: 403, code: undefined },
  { status: 403, code: 'invalid_signature' },
  { status: 502, code: 'fub_automations_restricted' },
  { status: 401, code: 'fub_automations_restricted' },
])('does not infer automation restrictions from status $status and code $code', async ({ status, code }) => {
  global.fetch = jest.fn(async () => Response.json({ code, error: 'Unavailable', uncertain: false }, { status }));

  await expect(readFubAutomations(123, true)).rejects.toMatchObject({
    code: 'fub_handoff_incomplete', status,
  });
});

it('does not apply an automation restriction code to other handoff operations', async () => {
  global.fetch = jest.fn(async () => Response.json({
    code: 'fub_automations_restricted', error: 'Unavailable', uncertain: false,
  }, { status: 403 }));

  await expect(getFubAgentChoices()).rejects.toMatchObject({ code: 'fub_handoff_incomplete', status: 403 });
});
