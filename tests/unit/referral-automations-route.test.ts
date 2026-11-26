/** @jest-environment node */
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/referrals/[id]/automations/route';
import { allowedMutation, loadAuthorized } from '@/lib/server/referral-fub-context';
import { readCustomerLink } from '@/lib/server/intelligence-links';
import { liveFubEnabled, readFubAutomations, startFubAutomation } from '@/lib/server/live-fub-handoff';
import { MockFubOperationError } from '@/lib/fub/mock-fub-orchestrator';
import { FubAutomationStart } from '@/models/fub-automation-start';
import { logReferralActivity } from '@/lib/server/activities';

jest.mock('@/lib/server/referral-fub-context', () => ({ allowedMutation: jest.fn(), loadAuthorized: jest.fn() }));
jest.mock('@/lib/server/intelligence-links', () => ({ readCustomerLink: jest.fn() }));
jest.mock('@/lib/server/live-fub-handoff', () => ({ liveFubEnabled: jest.fn(), readFubAutomations: jest.fn(), startFubAutomation: jest.fn() }));
jest.mock('@/models/fub-automation-start', () => ({ FubAutomationStart: { create: jest.fn(), updateOne: jest.fn(), deleteOne: jest.fn() } }));
jest.mock('@/lib/server/activities', () => ({ logReferralActivity: jest.fn() }));
const ctx = { params: { id: '507f1f77bcf86cd799439011' } };
const request = (personId = 123) => new NextRequest('https://test.invalid/api/referrals/r/automations', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ automationId: 10, expectedPersonId: personId, previousId: 0 }),
});
const viewer = { ok: true, configured: true, isAdmin: true, userId: 'u', accountId: 'a', organization: 'AHA' };
beforeEach(() => {
  jest.resetAllMocks();
  (allowedMutation as jest.Mock).mockReturnValue(true);
  (loadAuthorized as jest.Mock).mockResolvedValue(viewer);
  (readCustomerLink as jest.Mock).mockResolvedValue({ fubPersonId: 123 });
  (liveFubEnabled as jest.Mock).mockReturnValue(true);
});

it('permits a management read without exposing the catalog or start capability', async () => {
  (loadAuthorized as jest.Mock).mockResolvedValue({ ...viewer, isAdmin: false });
  (readFubAutomations as jest.Mock).mockResolvedValue({ personId: 123, enrollments: [], choices: [{ id: 9 }] });
  const result = await GET(request(), ctx);
  expect(await result.json()).toMatchObject({ canStart: false, choices: [] });
  expect(readFubAutomations).toHaveBeenCalledWith(123, false);
  expect((await POST(request(), ctx)).status).toBe(403);
  expect(startFubAutomation).not.toHaveBeenCalled();
});
it('blocks a cross-site request, a stale contact and preview writes before reserving a start', async () => {
  (allowedMutation as jest.Mock).mockReturnValueOnce(false);
  expect((await POST(request(), ctx)).status).toBe(403);
  expect((await POST(request(777), ctx)).status).toBe(409);
  (liveFubEnabled as jest.Mock).mockReturnValue(false);
  expect((await POST(request(), ctx)).status).toBe(503);
  expect(FubAutomationStart.create).not.toHaveBeenCalled();
});
it('records a confirmed start once and rejects a racing or replayed request', async () => {
  (FubAutomationStart.create as jest.Mock).mockResolvedValueOnce({}).mockRejectedValueOnce({ code: 11000 });
  (startFubAutomation as jest.Mock).mockResolvedValue({ personId: 123, enrollment: { id: 1, automationId: 10, name: 'Follow-up' } });
  const results = await Promise.all([POST(request(), ctx), POST(request(), ctx)]);
  expect(results.map(r => r.status).sort()).toEqual([201,409]);
  expect(startFubAutomation).toHaveBeenCalledTimes(1);
  expect(logReferralActivity).toHaveBeenCalledTimes(1);
});
it('keeps the reservation on an unconfirmed start but releases it after a definitive refusal', async () => {
  (startFubAutomation as jest.Mock).mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new MockFubOperationError('definitive','blocked','Ineligible',409));
  expect((await POST(request(), ctx)).status).toBe(502);
  expect(FubAutomationStart.deleteOne).not.toHaveBeenCalled();
  expect((await POST(request(), ctx)).status).toBe(409);
  expect(FubAutomationStart.deleteOne).toHaveBeenCalledTimes(1);
});
