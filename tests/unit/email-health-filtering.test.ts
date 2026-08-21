import { sendTransactionalEmailWithResult } from '@/lib/email';
import { partitionByHealth } from '@/lib/server/email-address-health';
import { EmailMessage } from '@/models/email-message';

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/models/email-message', () => ({
  EmailMessage: {
    create: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/lib/server/email-address-health', () => ({
  partitionByHealth: jest.fn(),
}));

const partitionByHealthMock = partitionByHealth as jest.MockedFunction<typeof partitionByHealth>;
const createMock = EmailMessage.create as jest.Mock;

/** Splits on a fixed set of bouncing addresses, mirroring what the real lookup would return. */
const stubHealth = (bouncing: string[]) => {
  const unhealthy = new Set(bouncing);
  partitionByHealthMock.mockImplementation(async (addresses: string[]) => ({
    healthy: addresses.filter((address) => !unhealthy.has(address)),
    withheld: addresses.filter((address) => unhealthy.has(address)),
  }));
};

const basePayload = {
  subject: 'New Referral: Jane Doe',
  html: '<p>Hi</p>',
  text: 'Hi',
};

describe('sendTransactionalEmailWithResult health filtering', () => {
  const originalApiKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'referrals@referrio.app';
    sendMock.mockReset();
    createMock.mockReset();
    createMock.mockResolvedValue(undefined);
    sendMock.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
  });

  afterAll(() => {
    process.env.RESEND_API_KEY = originalApiKey;
    process.env.EMAIL_FROM = originalFrom;
  });

  it('sends normally when every recipient is healthy', async () => {
    stubHealth([]);

    const result = await sendTransactionalEmailWithResult({
      ...basePayload,
      to: ['agent@example.com'],
      cc: ['coordinator@example.com'],
    });

    expect(result).toMatchObject({ ok: true, id: 'msg_123', suppressed: false });
    expect(result.withheldTo).toEqual([]);
    expect(result.withheldCc).toEqual([]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: ['agent@example.com'],
      cc: ['coordinator@example.com'],
    });
  });

  it('drops a bouncing CC address but still sends to the To recipient', async () => {
    stubHealth(['coordinator@example.com']);

    const result = await sendTransactionalEmailWithResult({
      ...basePayload,
      to: ['agent@example.com'],
      cc: ['coordinator@example.com', 'manager@example.com'],
    });

    expect(result.ok).toBe(true);
    expect(result.suppressed).toBe(false);
    expect(result.withheldCc).toEqual(['coordinator@example.com']);
    expect(sendMock.mock.calls[0][0].cc).toEqual(['manager@example.com']);
  });

  it('sends to the healthy subset when only some To recipients are bouncing', async () => {
    stubHealth(['bouncing@example.com']);

    const result = await sendTransactionalEmailWithResult({
      ...basePayload,
      to: ['bouncing@example.com', 'good@example.com'],
    });

    expect(result.ok).toBe(true);
    expect(result.suppressed).toBe(false);
    expect(result.withheldTo).toEqual(['bouncing@example.com']);
    expect(sendMock.mock.calls[0][0].to).toEqual(['good@example.com']);
  });

  it('suppresses the message when every To recipient is bouncing', async () => {
    stubHealth(['bouncing@example.com']);

    const result = await sendTransactionalEmailWithResult({
      ...basePayload,
      to: ['bouncing@example.com'],
    });

    expect(result.ok).toBe(false);
    expect(result.suppressed).toBe(true);
    expect(result.id).toBeNull();
    expect(result.withheldTo).toEqual(['bouncing@example.com']);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('records a suppressed message so the skipped send stays visible', async () => {
    stubHealth(['bouncing@example.com']);

    await sendTransactionalEmailWithResult({
      ...basePayload,
      to: ['bouncing@example.com'],
      cc: ['manager@example.com'],
      context: { referralId: 'referral-1' },
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toMatchObject({
      resendId: null,
      status: 'suppressed',
      to: [],
      cc: ['manager@example.com'],
      withheldTo: ['bouncing@example.com'],
      referralId: 'referral-1',
    });
  });

  it('records the withheld addresses alongside a successful send', async () => {
    stubHealth(['bouncing@example.com']);

    await sendTransactionalEmailWithResult({
      ...basePayload,
      to: ['good@example.com'],
      cc: ['bouncing@example.com'],
    });

    expect(createMock.mock.calls[0][0]).toMatchObject({
      resendId: 'msg_123',
      status: 'sent',
      to: ['good@example.com'],
      cc: [],
      withheldCc: ['bouncing@example.com'],
    });
  });

  it('reports a Resend rejection as a failure rather than a suppression', async () => {
    stubHealth([]);
    sendMock.mockResolvedValue({ data: null, error: { message: 'Invalid recipient' } });

    const result = await sendTransactionalEmailWithResult({
      ...basePayload,
      to: ['agent@example.com'],
    });

    expect(result.ok).toBe(false);
    expect(result.suppressed).toBe(false);
    expect(result.error).toBe('Invalid recipient');
    expect(createMock).not.toHaveBeenCalled();
  });
});
