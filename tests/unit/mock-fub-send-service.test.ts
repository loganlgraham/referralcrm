/**
 * @jest-environment node
 */

import { canUseMockFubFixture } from '@/lib/server/fixture-safety';
import { liveFubEnabled, getFubAgentChoices, readIntakeForHandoff } from '@/lib/server/live-fub-handoff';
import { authorizeFubViewer } from '@/lib/server/intelligence-viewer';
import { runMockFubApproval } from '@/lib/fub/mock-fub-orchestrator';
import { readMockFubApprovalPreview, sendOnPair } from '@/lib/server/mock-fub-send';
import { IntelligenceAgentLink, IntelligenceLink } from '@/models/intelligence-link';
import { MockFubSendAttempt, FubSendAttempt } from '@/models/mock-fub';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';

jest.mock('@/lib/server/live-fub-handoff', () => ({ liveFubEnabled: jest.fn(), createLiveFubClient: jest.fn(), getFubAgentChoices: jest.fn(), readIntakeForHandoff: jest.fn() }));
jest.mock('@/lib/server/intelligence-viewer', () => ({ authorizeFubViewer: jest.fn() }));
jest.mock('@/lib/fub/mock-fub-orchestrator', () => ({ ...jest.requireActual('@/lib/fub/mock-fub-orchestrator'), runMockFubApproval: jest.fn() }));

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
  FubSendAttempt: { findOne: jest.fn() },
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
    (liveFubEnabled as jest.Mock).mockReturnValue(false);
    gateMock.mockReturnValue(true);
    userFind.mockReturnValue(
      leanChain({ role: 'admin', active: true, disabled: false }),
    );
    referralFind.mockReturnValue(
      referralChain({
        _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        org: 'AFC',
        ahaBucket: null,
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
          ahaDesignation: 'AHA',
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

  it('dispatches a paired manual AHA referral through the verified handoff with the current agent', async () => {
    const actorId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const agentId = 'cccccccccccccccccccccccc';
    const session = { user: { id: actorId, role: 'admin' }, expires: '' } as const;
    (liveFubEnabled as jest.Mock).mockReturnValue(true);
    (authorizeFubViewer as jest.Mock).mockResolvedValue({ role: 'admin', userId: actorId, access: { ok: true } });
    (FubSendAttempt.findOne as jest.Mock).mockReturnValue(leanChain(null));
    customerLinkFind.mockReturnValue(leanChain({ fubPersonId: 42 }));
    referralFind.mockReturnValue(referralChain({
      org: 'AFC', origin: 'admin', status: 'Paired', borrower: { name: 'Taylor Client' },
      buySideAgent: { _id: agentId, name: 'Manual Agent', ahaDesignation: 'AHA' },
    }));
    (runMockFubApproval as jest.Mock).mockResolvedValue({ status: 'success', steps: [], personId: 42 });
    await expect(sendOnPair('aaaaaaaaaaaaaaaaaaaaaaaa', session, agentId)).resolves.toMatchObject({ sent: true });
    expect(runMockFubApproval).toHaveBeenCalledWith(expect.objectContaining({
      selectedAgentId: agentId, existingPersonId: 42, fubUserId: 71,
    }), expect.anything());
    await expect(sendOnPair('aaaaaaaaaaaaaaaaaaaaaaaa', session, 'different-agent')).resolves.toMatchObject({ sent: false });
    (authorizeFubViewer as jest.Mock).mockResolvedValue({ role: 'admin', access: { ok: false } });
    await expect(sendOnPair('aaaaaaaaaaaaaaaaaaaaaaaa', session, agentId)).resolves.toMatchObject({ sent: false });
    expect(runMockFubApproval).toHaveBeenCalledTimes(1);
  });

  it('assigns paired OOS customers to Kristen while retaining the selected Referrio agent and original intake', async () => {
    const actorId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const agentId = 'cccccccccccccccccccccccc';
    const session = { user: { id: actorId, role: 'admin' }, expires: '' } as const;
    (liveFubEnabled as jest.Mock).mockReturnValue(true);
    (getFubAgentChoices as jest.Mock).mockResolvedValue([{ id: 71, name: 'Manual Agent' }, { id: 72, name: 'Kristen Truong' }]);
    (authorizeFubViewer as jest.Mock).mockResolvedValue({ role: 'admin', userId: actorId, access: { ok: true } });
    (FubSendAttempt.findOne as jest.Mock).mockReturnValue(leanChain(null));
    (readIntakeForHandoff as jest.Mock).mockResolvedValue({ fields: { source: 'Original source' }, note: 'Original OOS email' });
    customerLinkFind.mockReturnValue(leanChain({ fubPersonId: 42 }));
    referralFind.mockReturnValue(referralChain({
      org: 'AHA', ahaBucket: 'AHA', inboundEmail: { channel: 'AHA_OOS', messageId: 'original-email' },
      status: 'Paired', borrower: { name: 'OOS Client' },
      buySideAgent: { _id: agentId, name: 'Manual Agent', ahaDesignation: 'AHA' },
    }));
    (runMockFubApproval as jest.Mock).mockResolvedValue({ status: 'success', steps: [], personId: 42 });
    await expect(readMockFubApprovalPreview({ referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa', actorId })).resolves.toMatchObject({
      ok: true, preview: { selectedAgentName: 'Manual Agent', fubAssigneeName: 'Kristen Truong', mappingState: 'ready' },
    });
    await expect(sendOnPair('aaaaaaaaaaaaaaaaaaaaaaaa', session, agentId)).resolves.toMatchObject({ sent: true });
    expect(agentLinkFind).not.toHaveBeenCalled();
    expect(runMockFubApproval).toHaveBeenCalledWith(expect.objectContaining({
      selectedAgentId: agentId, selectedAgentName: 'Manual Agent', existingPersonId: 42, fubUserId: 72, tags: ['OOS Referral'],
      note: expect.objectContaining({ body: 'Original OOS email' }),
    }), expect.anything());

    (getFubAgentChoices as jest.Mock).mockResolvedValue([{ id: 71, name: 'Manual Agent' }]);
    await expect(sendOnPair('aaaaaaaaaaaaaaaaaaaaaaaa', session, agentId)).resolves.toMatchObject({ sent: false, message: expect.stringContaining('Kristen Truong') });
    (getFubAgentChoices as jest.Mock).mockResolvedValue([{ id: 72, name: 'Kristen Truong' }, { id: 73, name: 'Kristen Truong' }]);
    await expect(sendOnPair('aaaaaaaaaaaaaaaaaaaaaaaa', session, agentId)).resolves.toMatchObject({ sent: false });
    expect(runMockFubApproval).toHaveBeenCalledTimes(1);
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
