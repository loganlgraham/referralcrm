/** @jest-environment node */
import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { loadAuthorized } from '@/lib/server/referral-fub-context';
import { Referral } from '@/models/referral';

jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn() }));
jest.mock('@/lib/server/intelligence-viewer', () => ({ authorizeFubViewer: jest.fn() }));
jest.mock('@/models/referral', () => ({ Referral: { findById: jest.fn() } }));

beforeEach(() => jest.clearAllMocks());

it('rejects unauthenticated FUB reads before opening Mongo or looking up a referral', async () => {
  (getCurrentSession as jest.Mock).mockResolvedValue(null);

  await expect(loadAuthorized('507f1f77bcf86cd799439011')).resolves.toEqual({
    ok: false, status: 401, reason: 'unauthenticated',
  });
  expect(connectMongo).not.toHaveBeenCalled();
  expect(Referral.findById).not.toHaveBeenCalled();
});

it('keeps invalid referral IDs as a 404 without querying Mongo', async () => {
  (getCurrentSession as jest.Mock).mockResolvedValue(null);

  await expect(loadAuthorized('not-an-id')).resolves.toEqual({
    ok: false, status: 404, reason: 'referral',
  });
  expect(connectMongo).not.toHaveBeenCalled();
  expect(Referral.findById).not.toHaveBeenCalled();
});
