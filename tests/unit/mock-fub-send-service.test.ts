/**
 * @jest-environment node
 */

import { canUseMockFubFixture } from '@/lib/server/fixture-safety';
import { readMockFubApprovalPreview } from '@/lib/server/mock-fub-send';
import { IntelligenceAgentLink, IntelligenceLink } from '@/models/intelligence-link';
import { MockFubSendAttempt } from '@/models/mock-fub';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';

jest.mock('@/lib/server/fixture-safety', () => ({
  canUseMockFubFixture: jest.fn(),
}));

jest.mock('@/models/user', () => ({
  User: { findById: jest.fn() },
}));

jest.mock('@/models/referral', () => ({
  Referral: { findById: jest.fn() },
}));

jest.mock('@/models/intelligence-link', () => ({
  IntelligenceAgentLink: { find: jest.fn() },
  IntelligenceLink: { findOne: jest.fn() },
}));

jest.mock('@/models/mock-fub', () => ({
  MockFubSendAttempt: { findOne: jest.fn() },
}));

const gateMock = canUseMockFubFixture as jest.MockedFunction<
  typeof canUseMockFubFixture
>;
const userFind = User.findById as jest.Mock;
const referralFind = Referral.findById as jest.Mock;
const agentLinkFind = IntelligenceAgentLink.find as jest.Mock;
const customerLinkFind = IntelligenceLink.findOne as jest.Mock;
const attemptFind = MockFubSendAttempt.findOne as jest.Mock;

function leanChain<T>(value: T) {
  return {
    select: jest.fn(() => ({
      lean: jest.fn(async () => value),
    })),
  };
}

function referralChain(value: Record<string, unknown>) {
  const chain = {
    populate: jest.fn(),
    lean: jest.fn(async () => value),
  };
  chain.populate.mockReturnValue(chain);
  return {
    select: jest.fn(() => chain),
  };
}

function linksChain(value: unknown[]) {
  return {
    select: jest.fn(() => ({
      lean: jest.fn(async () => value),
    })),
  };
}

describe('mock FUB approval preview service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    gateMock.mockReturnValue(true);
    userFind.mockReturnValue(
      leanChain({ role: 'admin', active: true, disabled: false }),
    );
    referralFind.mockReturnValue(
      referralChain({
        _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        org: 'AHA',
        ahaBucket: 'AHA',
        status: 'New Lead',
        borrower: {
          firstName: 'Taylor',
          lastName: 'Client',
          name: 'Taylor Client',
          email: 'taylor@example.com',
          phone: '303-555-0100',
        },
        buySideAgent: {
          _id: 'cccccccccccccccccccccccc',
          name: 'Manual Agent',
        },
        assignedAgent: {
          _id: 'dddddddddddddddddddddddd',
          name: 'Suggested Agent',
        },
        agentSelectionSource: 'manual',
        lookingInZip: '80014',
      }),
    );
    agentLinkFind.mockReturnValue(
      linksChain([
        {
          agentId: 'cccccccccccccccccccccccc',
          fubUserId: 71,
          audit: [{ action: 'link', nextPersonId: 71 }],
        },
      ]),
    );
    customerLinkFind.mockReturnValue(leanChain(null));
    attemptFind.mockReturnValue(leanChain(null));
  });

  it('shows the current manual override and its verified mapping', async () => {
    const result = await readMockFubApprovalPreview({
      referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      actorId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    });

    expect(result).toMatchObject({
      ok: true,
      preview: {
        customerName: 'Taylor Client',
        selectedAgentName: 'Manual Agent',
        selectionSource: 'manual',
        mappingState: 'ready',
        existingPersonId: null,
        attemptStatus: null,
      },
    });
    if (!result.ok) throw new Error('Expected preview');
    expect(result.preview.approvalKey).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('blocks AHA OOS before looking up a mapping', async () => {
    referralFind.mockReturnValue(
      referralChain({
        org: 'AHA',
        ahaBucket: 'AHA_OOS',
        borrower: { name: 'OOS Client' },
      }),
    );

    const result = await readMockFubApprovalPreview({
      referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      actorId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    });

    expect(result).toMatchObject({ ok: false, code: 'aha_oos' });
    expect(agentLinkFind).not.toHaveBeenCalled();
  });

  it('reports missing and ambiguous selected-agent mappings', async () => {
    agentLinkFind.mockReturnValueOnce(linksChain([]));
    await expect(
      readMockFubApprovalPreview({
        referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        actorId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).resolves.toMatchObject({
      ok: true,
      preview: { mappingState: 'missing' },
    });

    agentLinkFind.mockReturnValueOnce(
      linksChain([
        {
          agentId: 'cccccccccccccccccccccccc',
          fubUserId: 71,
          audit: [{ action: 'link', nextPersonId: 71 }],
        },
        {
          agentId: 'eeeeeeeeeeeeeeeeeeeeeeee',
          fubUserId: 71,
          audit: [{ action: 'link', nextPersonId: 71 }],
        },
      ]),
    );
    await expect(
      readMockFubApprovalPreview({
        referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        actorId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).resolves.toMatchObject({
      ok: true,
      preview: { mappingState: 'ambiguous' },
    });
  });

  it('rejects a disabled admin before loading the referral', async () => {
    userFind.mockReturnValue(
      leanChain({
        role: 'admin',
        active: true,
        disabled: false,
        status: ' InActive ',
      }),
    );

    await expect(
      readMockFubApprovalPreview({
        referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        actorId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'not_admin' });
    expect(referralFind).not.toHaveBeenCalled();
  });
});
