import crypto from 'crypto';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { LenderMC } from '@/models/lender';
import { sendTransactionalEmail } from '@/lib/email';
import { extractInboundEmailFieldsWithAI } from '@/lib/server/inbound-email-ai-parser';
import { logReferralActivity } from '@/lib/server/activities';
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';
import { cleanReferralNotes } from '@/lib/server/referral-notes-cleanup';
import { createAdminNotifications } from '@/lib/server/notifications';

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

jest.mock('@/models/lender', () => ({
  LenderMC: {
    find: jest.fn()
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

jest.mock('@/lib/server/activities', () => ({
  logReferralActivity: jest.fn()
}));

jest.mock('@/lib/server/admin-task-reconciler', () => ({
  generateAndReconcileAdminTasks: jest.fn()
}));

jest.mock('@/lib/server/referral-notes-cleanup', () => ({
  cleanReferralNotes: jest.fn()
}));

jest.mock('@/lib/server/notifications', () => ({
  createAdminNotifications: jest.fn()
}));

const mockedConnectMongo = connectMongo as jest.MockedFunction<typeof connectMongo>;
const mockedReferralFindOne = Referral.findOne as jest.Mock;
const mockedReferralCreate = Referral.create as jest.Mock;
const mockedLenderFind = LenderMC.find as jest.Mock;

type FakeObjectId = { toString: () => string };

function fakeObjectId(value: string): FakeObjectId {
  return { toString: () => value };
}

function mockLenderFindReturn(lenders: { _id: FakeObjectId; name: string }[]) {
  mockedLenderFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(lenders)
    })
  });
}
const mockedSendTransactionalEmail = sendTransactionalEmail as jest.MockedFunction<
  typeof sendTransactionalEmail
>;
const mockedExtractInboundEmailFieldsWithAI = extractInboundEmailFieldsWithAI as jest.MockedFunction<
  typeof extractInboundEmailFieldsWithAI
>;
const mockedLogReferralActivity = logReferralActivity as jest.MockedFunction<typeof logReferralActivity>;
const mockedGenerateAndReconcileAdminTasks =
  generateAndReconcileAdminTasks as jest.MockedFunction<typeof generateAndReconcileAdminTasks>;
const mockedCleanReferralNotes = cleanReferralNotes as jest.MockedFunction<typeof cleanReferralNotes>;
const mockedCreateAdminNotifications = createAdminNotifications as jest.MockedFunction<
  typeof createAdminNotifications
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

function mockResendInboundFetch(
  emailText: string,
  wrapInData = false,
  overrides: Partial<{ to: string[]; subject: string }> = {}
) {
  const payload = {
    id: 'resend-email-1',
    from: 'Sender <sender@example.com>',
    to: overrides.to ?? ['routing+aha@inbound.example.com'],
    subject: overrides.subject ?? 'New Referral',
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
    mockedLogReferralActivity.mockResolvedValue(undefined);
    mockedGenerateAndReconcileAdminTasks.mockResolvedValue(undefined);
    mockedCleanReferralNotes.mockImplementation(async (notes) => notes);
    mockedCreateAdminNotifications.mockResolvedValue(undefined);
    mockLenderFindReturn([]);
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
        loanFileNumber: '111',
        notes: []
      })
    );
    expect(mockedGenerateAndReconcileAdminTasks).toHaveBeenCalledWith({
      referralId: 'ref-1',
      trigger: 'referral.created'
    });
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

  it('falls back to AHA subject routing when forwarded email preserves original to address', async () => {
    mockResendInboundFetch(
      [
        'First: Jane',
        'Last: Doe',
        'BorrowerEmail: jane@example.com',
        'Phone: 303-555-1212',
        'ZipLookingIn: 80202',
        'LoanNumber: LN-111'
      ].join('\n'),
      false,
      {
        to: ['leads+americanhomeagents7530-o-2@kvcore.com'],
        subject: 'Add Contact'
      }
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ahaBucket: 'AHA',
        inboundEmail: expect.objectContaining({
          routeHint: 'aha',
          channel: 'AHA',
          subject: 'Add Contact'
        })
      })
    );
  });

  it('falls back to AHA OOS subject routing when forwarded email preserves original to address', async () => {
    mockResendInboundFetch(
      [
        'First: Jane',
        'Last: Doe',
        'BorrowerEmail: jane@example.com',
        'Phone: 303-555-1212',
        'ZipLookingIn: 80202',
        'LoanNumber: LN-111'
      ].join('\n'),
      false,
      {
        to: ['leads+americanhomeagents7530-o-2@kvcore.com'],
        subject: 'AHA Out of State Agent Needed'
      }
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ahaBucket: 'AHA_OOS',
        inboundEmail: expect.objectContaining({
          routeHint: 'ahaoos',
          channel: 'AHA_OOS',
          subject: 'AHA Out of State Agent Needed'
        })
      })
    );
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
        stageOnTransfer: 'Pre-approved',
        borrowerCurrentAddress: '20 Kelce Ave, Center Harbor, NH, 03226',
        loanType: 'FHA',
        loanFileNumber: '20130974679',
        preApprovalAmountCents: 8500000,
        lookingInZip: '27910',
        borrower: expect.objectContaining({
          name: 'Danielle Geldart',
          email: 'justinlounsbury05@gmail.com',
          phone: '863-440-6938'
        }),
        initialNotes: expect.stringContaining('MC: KarimL'),
        notes: expect.arrayContaining([
          expect.objectContaining({
            authorRole: 'system',
            authorName: 'Inbound Email Import',
            content: 'Need to purchase in NC'
          })
        ])
      })
    );
    expect(mockedCleanReferralNotes).toHaveBeenCalledWith('Need to purchase in NC', {
      allowFallbackToOriginal: true
    });
    expect(mockedLogReferralActivity).toHaveBeenCalledTimes(1);
    expect(mockedCreateAdminNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'referral_created',
        borrowerName: 'Danielle Geldart'
      })
    );
    expect(mockedSendTransactionalEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: expect.stringContaining('Loan Number: 20130974679')
      })
    );
    expect(mockedSendTransactionalEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: expect.stringContaining('Pre-approval Amount: $85,000.00')
      })
    );
    expect(mockedSendTransactionalEmail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: expect.stringContaining('Notes: Need to purchase in NC')
      })
    );
  });

  it('maps So/En and LoanType from common partner sample format', async () => {
    mockResendInboundFetch(
      [
        'First Name: Christopher',
        'Last Name: Rhoden',
        'Email: ccrhoden0925@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8032231108',
        'Price: $465000.00',
        'Area: 29073',
        'Zipcode: 29073',
        'Seller Address: 215 Cassique Drive, Lexington, SC, 29073',
        'Source: KarimL',
        'Referrer: PNC-Pre-Approved',
        'P & I/PITI: $2797.35/$3605.90',
        'Base Loan: $418500.00',
        'Notes: Might need help with realtor',
        'Loan Number: 20130975905',
        'LoanType:FHA',
        'LoanProgram:FHA 30 Year Fixed',
        'So: (Source):YouTube - Louder with Crowder',
        'En: (Endorser):Steven Crowder'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'YouTube - Louder with Crowder',
        endorser: 'Steven Crowder',
        loanType: 'FHA',
        stageOnTransfer: 'Pre-approved',
        loanFileNumber: '20130975905',
        preApprovalAmountCents: 46500000,
        borrowerCurrentAddress: '215 Cassique Drive, Lexington, SC, 29073',
        borrower: expect.objectContaining({
          name: 'Christopher Rhoden',
          email: 'ccrhoden0925@gmail.com',
          phone: '803-223-1108'
        })
      })
    );
  });

  it('appends Cobwr fields to initial notes and system note content when provided', async () => {
    mockResendInboundFetch(
      [
        'First Name: Sarah',
        'Last Name: Jordan',
        'Email: sjordan3409@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8637121067',
        'Price: $425000.00',
        'Area: 33811',
        'Zipcode: 33811',
        'Seller Address: 4342 Spring Lane, Lakeland, FL, 33811',
        'Source: JaredD',
        'Referrer: PNC-Pre-Approved',
        'Notes: bwrs looking in Polk County.',
        'Loan Number: 20130976807',
        'LoanType:Conventional',
        'LoanProgram:Conv Conf 30 Year Fixed',
        'So: (Source):YouTube - Louder with Crowder',
        'En: (Endorser):Steven Crowder',
        'CobwrFirst: Justin',
        'CobwrLast: Jordan',
        'CobwrPhone: 8637121067',
        'CobwrEmail: jjordon3409@gmail.com'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        initialNotes: expect.stringContaining(
          ['CobwrFirst: Justin', 'CobwrLast: Jordan', 'CobwrPhone: 863-712-1067', 'CobwrEmail: jjordon3409@gmail.com'].join(
            '\n'
          )
        ),
        notes: expect.arrayContaining([
          expect.objectContaining({
            content: [
              'bwrs looking in Polk County.',
              'CobwrFirst: Justin\nCobwrLast: Jordan\nCobwrPhone: 863-712-1067\nCobwrEmail: jjordon3409@gmail.com'
            ].join('\n\n')
          })
        ])
      })
    );
  });

  it('parses labels separated by literal <br> tags in plain-text body', async () => {
    mockResendInboundFetch(
      [
        'First Name: Ronald',
        'Last Name: Chavez',
        'Email: ronald.chavez@example.com',
        'Deal Type: Buyer',
        'Phone: 3082412347',
        'Price: $99000.00',
        'Area: 69145',
        'Zipcode: 69145',
        'Seller Address: 506 E 5th St., Kimball, NE, 69145',
        'Source: ChristopherL',
        'Referrer: PNC-Pre-Approved',
        'P & I/PITI: $622.42/$962.18',
        'Base Loan: $95535.00',
        'Notes: Is interested 508 E 3rd St, Kimball, NE 69145, wants to make an offer, would like full concessions',
        'Loan Number: 20130959550 <br>LoanType:FHA <br>LoanProgram:Essex DPA FHA 30 Year w/+2% 2nd DAP <br>So: (Source):Customer Referral <br>En: (Endorser):Other'
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
        source: 'Customer Referral',
        endorser: 'Other',
        loanType: 'FHA',
        loanFileNumber: '20130959550',
        stageOnTransfer: 'Pre-approved',
        preApprovalAmountCents: 9900000,
        lookingInZip: '69145',
        borrowerCurrentAddress: '506 E 5th St., Kimball, NE, 69145',
        borrower: expect.objectContaining({
          name: 'Ronald Chavez',
          email: 'ronald.chavez@example.com',
          phone: '308-241-2347'
        })
      })
    );
  });

  it('truncates inbound loan numbers longer than 11 digits to the first 11', async () => {
    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Source: KarimL',
        'Loan Number: 2013097467999'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        loanFileNumber: '20130974679'
      })
    );
  });

  it('leaves source, endorser, and loanType blank when nested labels are malformed or missing', async () => {
    mockResendInboundFetch(
      [
        'First Name: Jordan',
        'Last Name: Buyer',
        'Email: jordan.buyer@example.com',
        'Deal Type: Buyer',
        'Phone: 3035558080',
        'Zipcode: 80202',
        'Source: KarimL',
        'Loan Number: 20130975906',
        'So: Source - YouTube',
        'En: Endorser - Steven Crowder',
        'LoanType:'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: '',
        endorser: '',
        loanType: '',
        borrower: expect.objectContaining({
          name: 'Jordan Buyer',
          email: 'jordan.buyer@example.com',
          phone: '303-555-8080'
        }),
        loanFileNumber: '20130975906'
      })
    );
  });

  it('assigns a matching mortgage consultant when Source token matches a single LenderMC', async () => {
    const lenderId = fakeObjectId('lender-karim');
    mockLenderFindReturn([
      { _id: lenderId, name: 'Karim Lopez' },
      { _id: fakeObjectId('lender-jane'), name: 'Jane Doe' }
    ]);

    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Source: KarimL',
        'Loan Number: 20130974679'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        lender: lenderId,
        initialNotes: expect.stringContaining('MC: Karim Lopez (source: KarimL)')
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Auto-assigned mortgage consultant Karim Lopez')
      })
    );
  });

  it('assigns a matching mortgage consultant when Source token uses ChristopherL alias', async () => {
    const lenderId = fakeObjectId('lender-chris');
    mockLenderFindReturn([
      { _id: lenderId, name: 'Chris Leo' },
      { _id: fakeObjectId('lender-jane'), name: 'Jane Doe' }
    ]);

    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Source: ChristopherL',
        'Loan Number: 20130974679'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        lender: lenderId,
        initialNotes: expect.stringContaining('MC: Chris Leo (source: ChristopherL)')
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Auto-assigned mortgage consultant Chris Leo')
      })
    );
  });

  it('assigns a matching mortgage consultant when Source token uses JasonCr alias', async () => {
    const lenderId = fakeObjectId('lender-jason');
    mockLenderFindReturn([
      { _id: lenderId, name: 'Jason Creech' },
      { _id: fakeObjectId('lender-jane'), name: 'Jane Doe' }
    ]);

    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Source: JasonCr',
        'Loan Number: 20130974679'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        lender: lenderId,
        initialNotes: expect.stringContaining('MC: Jason Creech (source: JasonCr)')
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Auto-assigned mortgage consultant Jason Creech')
      })
    );
  });

  it('assigns a matching mortgage consultant when Source token uses NebiyuA alias', async () => {
    const lenderId = fakeObjectId('lender-neb');
    mockLenderFindReturn([
      { _id: lenderId, name: 'Neb Ayalew' },
      { _id: fakeObjectId('lender-jane'), name: 'Jane Doe' }
    ]);

    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Source: NebiyuA',
        'Loan Number: 20130974679'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        lender: lenderId,
        initialNotes: expect.stringContaining('MC: Neb Ayalew (source: NebiyuA)')
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Auto-assigned mortgage consultant Neb Ayalew')
      })
    );
  });

  it('leaves lender unassigned when Source token does not match any LenderMC', async () => {
    mockLenderFindReturn([{ _id: fakeObjectId('lender-jane'), name: 'Jane Doe' }]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Source: KarimL',
        'Loan Number: 20130974679'
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
    const createArgs = mockedReferralCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArgs.lender).toBeUndefined();
    expect(createArgs.initialNotes).toEqual(expect.stringContaining('MC: KarimL'));
    expect(warnSpy).toHaveBeenCalledWith(
      'Inbound email MC source unmatched',
      expect.objectContaining({ mcValue: 'KarimL', reason: 'no_match' })
    );

    warnSpy.mockRestore();
  });

  it('leaves lender unassigned when Source token is ambiguous across multiple LenderMCs', async () => {
    mockLenderFindReturn([
      { _id: fakeObjectId('lender-karim-lopez'), name: 'Karim Lopez' },
      { _id: fakeObjectId('lender-karim-lang'), name: 'Karim Lang' }
    ]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Source: KarimL',
        'Loan Number: 20130974679'
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
    const createArgs = mockedReferralCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArgs.lender).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'Inbound email MC source ambiguous',
      expect.objectContaining({ mcValue: 'KarimL', reason: 'ambiguous_match' })
    );

    warnSpy.mockRestore();
  });

  it('auto-assigns MC from free text when Source field is missing but FirstNameLastInitial appears elsewhere', async () => {
    const lenderId = fakeObjectId('lender-karim');
    mockLenderFindReturn([
      { _id: lenderId, name: 'Karim Lopez' },
      { _id: fakeObjectId('lender-jane'), name: 'Jane Doe' }
    ]);

    mockResendInboundFetch(
      [
        'First Name: Danielle',
        'Last Name: Geldart',
        'Email: justinlounsbury05@gmail.com',
        'Deal Type: Buyer',
        'Phone: 8634406938',
        'Area: 27910',
        'Loan Number: 20130974679 KarimL',
        'Referrer: Random Partner'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        lender: lenderId,
        initialNotes: expect.stringContaining('MC: Karim Lopez (detected in email body)')
      })
    );
    expect(mockedLogReferralActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          'Auto-assigned mortgage consultant Karim Lopez (detected in inbound email body)'
        )
      })
    );
  });

  it('maps non-PNC referrer values to Pre-approval TBD stage', async () => {
    mockResendInboundFetch(
      [
        'First Name: Jane',
        'Last Name: Buyer',
        'Email: janebuyer@example.com',
        'Deal Type: Buyer',
        'Phone: 720-555-0000',
        'Zipcode: 80202',
        'Referrer: Random Partner',
        'Loan Number: 20130974680'
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
    expect(mockedReferralCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        stageOnTransfer: 'Pre-approval TBD'
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
        loanFileNumber: '222'
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
