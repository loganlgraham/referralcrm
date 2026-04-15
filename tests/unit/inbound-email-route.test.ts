import crypto from 'crypto';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { sendTransactionalEmail } from '@/lib/email';
import { extractInboundEmailFieldsWithAI } from '@/lib/server/inbound-email-ai-parser';

let postHandler: typeof import('@/app/api/inbound-email/route').POST;

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

  return {
    NextRequest: class {},
    NextResponse: MockNextResponse
  };
});

jest.mock('@/lib/mongoose', () => ({
  connectMongo: jest.fn()
}));

jest.mock('@/models/referral', () => ({
  Referral: {
    findOne: jest.fn(),
    create: jest.fn()
  }
}));

jest.mock('@/lib/server/gcs', () => ({
  uploadEmailAttachment: jest.fn()
}));

jest.mock('@/lib/email', () => ({
  sendTransactionalEmail: jest.fn()
}));

jest.mock('@/lib/referral-links', () => ({
  buildReferralLink: jest.fn(() => 'https://example.com/referrals/ref-1')
}));

jest.mock('@/lib/server/inbound-email-ai-parser', () => ({
  extractInboundEmailFieldsWithAI: jest.fn()
}));

const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedReferralFindOne = Referral.findOne as jest.Mock;
const mockedReferralCreate = Referral.create as jest.Mock;
const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<
  typeof sendTransactionalEmail
>;
const mockedExtractInboundEmailFieldsWithAI = extractInboundEmailFieldsWithAI as jest.MockedFunction<
  typeof extractInboundEmailFieldsWithAI
>;

function signBody(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function signSvixBody(rawBody: string, secret: string, timestamp: string, messageId: string): string {
  const secretRaw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  const secretBytes = Uint8Array.from(Buffer.from(secretRaw, 'base64'));
  const payload = `${messageId}.${timestamp}.${rawBody}`;
  const digest = crypto.createHmac('sha256', secretBytes).update(payload, 'utf8').digest('base64');
  return `v1,${digest}`;
}

function makeWebhookRequest(
  rawBody: string,
  signature: string,
  extraHeaders?: Record<string, string>,
  signatureHeaderName = 'resend-signature'
) {
  const headerMap = new Map<string, string>([[signatureHeaderName.toLowerCase(), signature]]);
  Object.entries(extraHeaders ?? {}).forEach(([key, value]) => {
    headerMap.set(key.toLowerCase(), value);
  });
  return {
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null
    },
    text: async () => rawBody
  } as any;
}

function mockResendInboundFetch(emailText: string, wrapInData = false) {
  const payload = {
    id: 'resend-email-1',
    from: 'Sender <sender@example.com>',
    to: ['routing+aha@inbound.example.com'],
    subject: 'New Referral',
    text: emailText,
    attachments: []
  };
  (global as { fetch: typeof fetch }).fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => (wrapInData ? { data: payload } : payload)
  }) as unknown as typeof fetch;
}

describe('POST /api/inbound-email', () => {
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    ({ POST: postHandler } = await import('@/app/api/inbound-email/route'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      RESEND_INBOUND_SECRET: 'inbound-secret',
      RESEND_API_KEY: 'resend-api-key',
      OPENAI_API_KEY: 'openai-api-key'
    };

    mockedConnectMongo.mockResolvedValue(undefined as never);
    mockedReferralFindOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(null)
    });
    mockedReferralCreate.mockResolvedValue({
      _id: {
        toString: () => 'ref-1'
      }
    });
    mockedSendTransactionalEmail.mockResolvedValue(true);
    mockedExtractInboundEmailFieldsWithAI.mockResolvedValue(null);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('creates referral from deterministic labeled fields without AI fallback', async () => {
    mockResendInboundFetch(
      [
        'First: Jane',
        'Last: Doe',
        'BorrowerEmail: jane@example.com',
        'Phone: (303) 555-1212',
        'ZipLookingIn: 80202',
        'LoanNumber: LN-111'
      ].join('\n')
    );

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'resend-email-1' }
    });

    const response: any = await postHandler(
      makeWebhookRequest(rawBody, signBody(rawBody, process.env.RESEND_INBOUND_SECRET as string))
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'created', referralId: 'ref-1' });
    expect(mockedExtractInboundEmailFieldsWithAI).not.toHaveBeenCalled();
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        borrower: expect.objectContaining({
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '303-555-1212'
        }),
        loanFileNumber: 'LN-111'
      })
    );
  });

  it('handles Resend receiving API response wrapped in data', async () => {
    mockResendInboundFetch(
      [
        'First: Jane',
        'Last: Doe',
        'BorrowerEmail: jane@example.com',
        'Phone: 303-555-1212',
        'ZipLookingIn: 80202',
        'LoanNumber: LN-111'
      ].join('\n'),
      true
    );

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'resend-email-1' }
    });

    const response: any = await postHandler(
      makeWebhookRequest(rawBody, signBody(rawBody, process.env.RESEND_INBOUND_SECRET as string))
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'created', referralId: 'ref-1' });
  });

  it('maps source and alias labels from partner email format', async () => {
    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Price: $85000.00',
        'Area: 27910',
        'Zipcode: 27910',
        'Seller Address: 20 Kelce Ave, Center Harbor, NH, 03226',
        'Source: KarimL',
        'Referrer: PNC-Pre-Approved',
        'Notes: Need to purchase in NC',
        'Loan Number: 20130974679',
        'LoanType:FHA',
        'So: (Source):National Podcast - Candace Owens',
        'En: (Endorser):Candace Owens'
      ].join('\n')
    );

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'resend-email-1' }
    });

    const response: any = await postHandler(
      makeWebhookRequest(rawBody, signBody(rawBody, process.env.RESEND_INBOUND_SECRET as string))
    );

    expect(response.status).toBe(200);
    expect(mockedExtractInboundEmailFieldsWithAI).not.toHaveBeenCalled();
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'National Podcast - Candace Owens',
        endorser: 'Candace Owens',
        borrowerCurrentAddress: '20 Kelce Ave, Center Harbor, NH, 03226',
        loanType: 'FHA',
        loanFileNumber: '20130974679',
        lookingInZip: '27910',
        borrower: expect.objectContaining({
          name: 'Danielle Geldart',
          email: 'justinlounsbury05@gmail.com',
          phone: '863-440-6938'
        }),
        initialNotes: expect.stringContaining('MC: KarimL')
      })
    );
  });

  it('creates referral when labeled fields miss required data but AI fallback succeeds', async () => {
    mockResendInboundFetch('Prospect details are below in narrative form.');
    mockedExtractInboundEmailFieldsWithAI.mockResolvedValue({
      first: 'Avery',
      last: 'Buyer',
      borroweremail: 'avery@example.com',
      phone: '1 (720) 555-9999',
      ziplookingin: '80203',
      loannumber: 'LN-222'
    });

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'resend-email-1' }
    });

    const response: any = await postHandler(
      makeWebhookRequest(rawBody, signBody(rawBody, process.env.RESEND_INBOUND_SECRET as string))
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'created', referralId: 'ref-1' });
    expect(mockedExtractInboundEmailFieldsWithAI).toHaveBeenCalledTimes(1);
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        borrower: expect.objectContaining({
          name: 'Avery Buyer',
          email: 'avery@example.com',
          phone: '720-555-9999'
        }),
        loanFileNumber: 'LN-222'
      })
    );
  });

  it('returns 400 when phone cannot be normalized to ###-###-####', async () => {
    mockResendInboundFetch(
      [
        'First: Jane',
        'Last: Doe',
        'BorrowerEmail: jane@example.com',
        'Phone: 55512',
        'ZipLookingIn: 80202',
        'LoanNumber: LN-111'
      ].join('\n')
    );
    mockedExtractInboundEmailFieldsWithAI.mockResolvedValue(null);

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'resend-email-1' }
    });

    const response: any = await postHandler(
      makeWebhookRequest(rawBody, signBody(rawBody, process.env.RESEND_INBOUND_SECRET as string))
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Inbound email is missing borrower contact details or loan number.'
    });
    expect(mockedReferralCreate).not.toHaveBeenCalled();
  });

  it('accepts Svix signature headers for inbound webhook delivery', async () => {
    const svixSecret = `whsec_${Buffer.from('test-svix-secret', 'utf8').toString('base64')}`;
    process.env.RESEND_INBOUND_SECRET = svixSecret;

    mockResendInboundFetch(
      [
        'First Name: Ernesto',
        'Last Name: Ocana',
        'Email: jovia218@gmail.com',
        'Deal Type: Buyer',
        'Phone: 720-288-7749',
        'Zipcode: 80602',
        'Loan Number: 20130975325'
      ].join('\n')
    );

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'resend-email-1' }
    });
    const svixTimestamp = '1776270931';
    const svixId = 'msg_3COyV4NVKWNAZ3hvocix8xn3nCx';
    const svixSignature = signSvixBody(rawBody, svixSecret, svixTimestamp, svixId);

    const response: any = await postHandler(
      makeWebhookRequest(
        rawBody,
        svixSignature,
        {
        'svix-signature': svixSignature,
        'svix-timestamp': svixTimestamp,
        'svix-id': svixId
        },
        'svix-signature'
      )
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'created', referralId: 'ref-1' });
  });

  it('returns 400 when deterministic parse fails and AI fallback returns nothing', async () => {
    mockResendInboundFetch('Missing labeled fields and no parseable details.');
    mockedExtractInboundEmailFieldsWithAI.mockResolvedValue(null);

    const rawBody = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'resend-email-1' }
    });

    const response: any = await postHandler(
      makeWebhookRequest(rawBody, signBody(rawBody, process.env.RESEND_INBOUND_SECRET as string))
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Inbound email is missing borrower contact details or loan number.'
    });
    expect(mockedExtractInboundEmailFieldsWithAI).toHaveBeenCalledTimes(1);
    expect(mockedReferralCreate).not.toHaveBeenCalled();
  });
});
