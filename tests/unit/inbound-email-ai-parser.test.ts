import { extractInboundEmailFieldsWithAI } from '@/lib/server/inbound-email-ai-parser';

describe('extractInboundEmailFieldsWithAI', () => {
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.resetAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  afterAll(() => {
    if (originalApiKey) {
      process.env.OPENAI_API_KEY = originalApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('returns null when OPENAI_API_KEY is not set', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = jest.fn();
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await extractInboundEmailFieldsWithAI({
      text: 'Borrower is Jane Doe',
      to: ['routing+aha@example.com']
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps valid OpenAI response to normalized inbound fields', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                firstName: 'Jane',
                lastName: 'Doe',
                borrowerEmail: 'jane@example.com',
                borrowerPhone: '(303) 555-1212',
                zipCodes: ['80202', '80203'],
                loanFileNumber: 'LN-123',
                source: 'UmedY',
                referralSource: 'National Podcast - Candace Owens',
                referrer: 'PNC-Pre-Approved',
                dealType: 'Buyer'
              })
            }
          }
        ]
      })
    });
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await extractInboundEmailFieldsWithAI({
      text: 'Referral details in freeform text',
      to: ['routing+aha@example.com']
    });

    expect(result).toEqual({
      first: 'Jane',
      last: 'Doe',
      borroweremail: 'jane@example.com',
      phone: '(303) 555-1212',
      ziplookingin: '80202, 80203',
      loannumber: 'LN-123',
      source: 'UmedY',
      sosource: 'National Podcast - Candace Owens',
      referrer: 'PNC-Pre-Approved',
      dealtype: 'Buyer'
    });
  });

  it('returns null when OpenAI response schema is invalid', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"zipCodes":"not-an-array"}'
            }
          }
        ]
      })
    });
    (global as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await extractInboundEmailFieldsWithAI({
      text: 'Referral details in freeform text',
      to: ['routing+aha@example.com']
    });

    expect(result).toBeNull();
  });
});
