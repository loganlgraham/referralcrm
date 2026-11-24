/**
 * @jest-environment node
 */

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import {
  approveMockFubSend,
  readMockFubApprovalPreview,
} from '@/lib/server/mock-fub-send';

let getHandler: typeof import('@/app/api/referrals/[id]/fub-send/route').GET;
let postHandler: typeof import('@/app/api/referrals/[id]/fub-send/route').POST;

jest.mock('next/server', () => {
  class MockNextResponse {
    status: number;
    body: unknown;

    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }

    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  }

  return { NextRequest: class {}, NextResponse: MockNextResponse };
});

jest.mock('@/lib/auth', () => ({
  getCurrentSession: jest.fn(),
}));

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn(),
}));

jest.mock('@/lib/server/mock-fub-send', () => ({
  approveMockFubSend: jest.fn(),
  readMockFubApprovalPreview: jest.fn(),
}));

const sessionMock = getCurrentSession as jest.MockedFunction<typeof getCurrentSession>;
const connectMock = connectMongo as jest.MockedFunction<typeof connectMongo>;
const previewMock = readMockFubApprovalPreview as jest.MockedFunction<
  typeof readMockFubApprovalPreview
>;
const approvalMock = approveMockFubSend as jest.MockedFunction<
  typeof approveMockFubSend
>;

function request(input?: {
  body?: Record<string, unknown>;
  fetchSite?: string;
  origin?: string;
}) {
  const headers = new Headers({
    origin: input?.origin ?? 'http://localhost:3000',
    'sec-fetch-site': input?.fetchSite ?? 'same-origin',
  });
  return {
    headers,
    nextUrl: { origin: 'http://localhost:3000' },
    json: async () => input?.body ?? {},
  } as never;
}

describe('mock FUB send route', () => {
  beforeAll(async () => {
    const route = await import('@/app/api/referrals/[id]/fub-send/route');
    getHandler = route.GET;
    postHandler = route.POST;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    connectMock.mockResolvedValue(undefined as never);
    sessionMock.mockResolvedValue({
      user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'admin' },
    } as never);
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        customerName: 'Taylor Client',
        selectedAgentName: 'Manual Agent',
        selectionSource: 'manual',
        mappingState: 'ready',
        existingPersonId: null,
        approvalKey: 'approval-key',
        attemptStatus: null,
      },
    });
    approvalMock.mockResolvedValue({
      ok: true,
      result: {
        status: 'success',
        personId: 501,
        steps: [],
        recovered: false,
      },
    });
  });

  it('allows an admin to preview the current customer and selected agent', async () => {
    const response = (await getHandler(request(), {
      params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    })) as never as { status: number; body: unknown };

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      selectedAgentName: 'Manual Agent',
      selectionSource: 'manual',
    });
  });

  it('rejects non-admin roles before reading fixture state', async () => {
    sessionMock.mockResolvedValue({
      user: { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', role: 'manager' },
    } as never);

    const response = (await getHandler(request(), {
      params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    })) as never as { status: number };

    expect(response.status).toBe(403);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('rejects cross-site approval and never starts an operation', async () => {
    const response = (await postHandler(
      request({
        body: { approvalKey: 'approval-1' },
        fetchSite: 'cross-site',
        origin: 'https://attacker.example',
      }),
      { params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } },
    )) as never as { status: number };

    expect(response.status).toBe(403);
    expect(approvalMock).not.toHaveBeenCalled();
  });

  it('passes an explicit approval key and actor to the fixture service', async () => {
    const response = (await postHandler(
      request({ body: { approvalKey: 'approval-1' } }),
      { params: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' } },
    )) as never as { status: number; body: unknown };

    expect(response.status).toBe(200);
    expect(approvalMock).toHaveBeenCalledWith({
      referralId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      actorId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      approvalKey: 'approval-1',
    });
    expect(response.body).toMatchObject({ status: 'success', personId: 501 });
  });
});
