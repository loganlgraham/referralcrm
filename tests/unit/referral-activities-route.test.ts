/** @jest-environment node */

import { GET } from '@/app/api/referrals/[id]/activities/route';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';
import { Activity } from '@/models/activity';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';

jest.mock('@/lib/auth', () => ({ getCurrentSession: jest.fn() }));
jest.mock('@/lib/mongoose', () => ({ connectMongo: jest.fn(async () => undefined) }));
jest.mock('@/lib/rbac', () => ({ canViewReferral: jest.fn(() => true) }));
jest.mock('@/models/referral', () => ({ Referral: { findById: jest.fn() } }));
jest.mock('@/models/activity', () => ({ Activity: { find: jest.fn() } }));
jest.mock('@/models/user', () => ({ User: { find: jest.fn() } }));

const mockSession = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const mockCanView = canViewReferral as jest.MockedFunction<typeof canViewReferral>;
const mockFindReferral = Referral.findById as jest.Mock;
const mockFindActivity = Activity.find as jest.Mock;

function referralChain() {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn(() => chain);
  chain.populate = jest.fn(() => chain);
  chain.lean = jest.fn(async () => ({
    assignedAgent: null,
    buySideAgent: null,
    sellSideAgent: null,
    lender: null,
    notes: [],
    org: 'AHA',
    deletedAt: null,
  }));
  return chain;
}

function activityChain(rows: unknown[]) {
  return {
    sort: jest.fn(() => ({
      lean: jest.fn(async () => rows),
    })),
  };
}

describe('GET /api/referrals/[id]/activities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanView.mockReturnValue(true);
    mockFindReferral.mockReturnValue(referralChain());
    mockFindActivity.mockReturnValue(activityChain([]));
    (User.find as jest.Mock).mockReturnValue({
      select: jest.fn(() => ({ lean: jest.fn(async () => []) })),
    });
  });

  it('returns only status moves to an agent who can open the referral', async () => {
    mockSession.mockResolvedValue({
      expires: '',
      user: { id: 'agent-user', role: 'agent', email: 'agent@example.com' },
    } as never);

    const response = await GET({} as never, { params: { id: 'ref-1' } });

    expect(response.status).toBe(200);
    expect(mockFindActivity).toHaveBeenCalledWith({ referralId: 'ref-1', channel: 'status' });
  });

  it('returns the full timeline to an admin', async () => {
    mockSession.mockResolvedValue({
      expires: '',
      user: { id: 'admin-user', role: 'admin', email: 'admin@example.com' },
    } as never);

    const response = await GET({} as never, { params: { id: 'ref-1' } });

    expect(response.status).toBe(200);
    expect(mockFindActivity).toHaveBeenCalledWith({ referralId: 'ref-1' });
  });

  it('hides the timeline from someone who cannot open the referral', async () => {
    mockSession.mockResolvedValue({
      expires: '',
      user: { id: 'agent-user', role: 'agent', email: 'agent@example.com' },
    } as never);
    mockCanView.mockReturnValue(false);

    const response = await GET({} as never, { params: { id: 'ref-1' } });

    expect(response.status).toBe(403);
    expect(mockFindActivity).not.toHaveBeenCalled();
  });
});
