import { z } from 'zod';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const FALLBACK_MODEL = 'gpt-4o-mini';

const aiExtractionSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  fullName: z.string().optional(),
  borrowerEmail: z.string().optional(),
  borrowerPhone: z.string().optional(),
  zipCodes: z.array(z.string()).optional(),
  zipCode: z.string().optional(),
  loanFileNumber: z.string().optional(),
  estimatedPrice: z.string().optional(),
  borrowerAddress: z.string().optional(),
  stageOnTransfer: z.string().optional(),
  loanType: z.string().optional(),
  source: z.string().optional(),
  referralSource: z.string().optional(),
  endorser: z.string().optional(),
  referrer: z.string().optional(),
  notes: z.string().optional(),
  mc: z.string().optional(),
  mcName: z.string().optional(),
  dealType: z.string().optional()
});

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().min(1)
        })
      })
    )
    .min(1)
});

export type InboundEmailAIFallbackFields = Record<string, string>;

function normalizeTextValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeZipCodes(raw: string[] | undefined): string | undefined {
  if (!raw || raw.length === 0) {
    return undefined;
  }
  const normalized = Array.from(
    new Set(
      raw
        .map((entry) => entry.replace(/[^0-9]/g, '').slice(0, 5))
        .filter((zip) => zip.length === 5)
    )
  );
  return normalized.length > 0 ? normalized.join(', ') : undefined;
}

function toFallbackFieldMap(parsed: z.infer<typeof aiExtractionSchema>): InboundEmailAIFallbackFields {
  const map: InboundEmailAIFallbackFields = {};

  const firstName = normalizeTextValue(parsed.firstName);
  const lastName = normalizeTextValue(parsed.lastName);
  const fullName = normalizeTextValue(parsed.fullName);
  const borrowerEmail = normalizeTextValue(parsed.borrowerEmail);
  const borrowerPhone = normalizeTextValue(parsed.borrowerPhone);
  const zipLookingIn = normalizeZipCodes(parsed.zipCodes);
  const zipCode = normalizeTextValue(parsed.zipCode);
  const loanFileNumber = normalizeTextValue(parsed.loanFileNumber);
  const estimatedPrice = normalizeTextValue(parsed.estimatedPrice);
  const borrowerAddress = normalizeTextValue(parsed.borrowerAddress);
  const stageOnTransfer = normalizeTextValue(parsed.stageOnTransfer);
  const loanType = normalizeTextValue(parsed.loanType);
  const source = normalizeTextValue(parsed.source);
  const referralSource = normalizeTextValue(parsed.referralSource);
  const endorser = normalizeTextValue(parsed.endorser);
  const referrer = normalizeTextValue(parsed.referrer);
  const notes = normalizeTextValue(parsed.notes);
  const mc = normalizeTextValue(parsed.mc);
  const mcName = normalizeTextValue(parsed.mcName);
  const dealType = normalizeTextValue(parsed.dealType);

  if (firstName) {
    map.first = firstName;
  }
  if (lastName) {
    map.last = lastName;
  }
  if (fullName) {
    map.fullname = fullName;
  }
  if (borrowerEmail) {
    map.borroweremail = borrowerEmail;
  }
  if (borrowerPhone) {
    map.phone = borrowerPhone;
  }
  if (zipLookingIn) {
    map.ziplookingin = zipLookingIn;
  } else if (zipCode) {
    map.ziplookingin = zipCode;
  }
  if (loanFileNumber) {
    map.loannumber = loanFileNumber;
  }
  if (estimatedPrice) {
    map.estimatedprice = estimatedPrice;
  }
  if (borrowerAddress) {
    map.borroweraddress = borrowerAddress;
  }
  if (stageOnTransfer) {
    map.stageontransfer = stageOnTransfer;
  }
  if (loanType) {
    map.loantype = loanType;
  }
  if (source) {
    map.source = source;
  }
  if (referralSource) {
    map.sosource = referralSource;
  }
  if (endorser) {
    map.endorser = endorser;
  } else if (referrer) {
    map.endorser = referrer;
  }
  if (notes) {
    map.notes = notes;
  }
  if (mc) {
    map.mc = mc;
  } else if (mcName) {
    map.mc = mcName;
  }
  if (dealType) {
    map.dealtype = dealType;
  }

  return map;
}

function getFallbackPrompt(): string {
  return [
    'Extract referral intake fields from inbound mortgage referral emails.',
    'Return only JSON matching the schema.',
    'Prefer exact text spans from the email when possible.',
    "Important mapping rule: in many templates, 'Source' means MC name.",
    "If a line like 'So: (Source): ...' appears, map that value to referralSource (not MC name).",
    "If a line like 'Referrer:' appears, map it to endorser/referrer."
  ].join(' ');
}

export async function extractInboundEmailFieldsWithAI(input: {
  text: string;
  subject?: string;
  from?: string;
  to: string[];
}): Promise<InboundEmailAIFallbackFields | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const text = input.text.trim();
  if (!text) {
    return null;
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: FALLBACK_MODEL,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'inbound_email_referral_fields',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                fullName: { type: 'string' },
                borrowerEmail: { type: 'string' },
                borrowerPhone: { type: 'string' },
                zipCodes: {
                  type: 'array',
                  items: { type: 'string' }
                },
                zipCode: { type: 'string' },
                loanFileNumber: { type: 'string' },
                estimatedPrice: { type: 'string' },
                borrowerAddress: { type: 'string' },
                stageOnTransfer: { type: 'string' },
                loanType: { type: 'string' },
                source: { type: 'string' },
                referralSource: { type: 'string' },
                endorser: { type: 'string' },
                referrer: { type: 'string' },
                notes: { type: 'string' },
                mc: { type: 'string' },
                mcName: { type: 'string' },
                dealType: { type: 'string' }
              },
              required: []
            }
          }
        },
        messages: [
          {
            role: 'system',
            content: getFallbackPrompt()
          },
          {
            role: 'user',
            content: JSON.stringify({
              subject: input.subject ?? '',
              from: input.from ?? '',
              to: input.to,
              bodyText: text
            })
          }
        ]
      })
    });

    if (!response.ok) {
      const errorPayload = await response.text().catch(() => '');
      console.error('Inbound AI fallback request failed', { status: response.status, errorPayload });
      return null;
    }

    const completionJson: unknown = await response.json();
    const parsedCompletion = completionSchema.safeParse(completionJson);
    if (!parsedCompletion.success) {
      return null;
    }

    const content = parsedCompletion.data.choices[0]?.message.content;
    if (!content) {
      return null;
    }

    const parsedContent: unknown = JSON.parse(content);
    const parsedExtraction = aiExtractionSchema.safeParse(parsedContent);
    if (!parsedExtraction.success) {
      return null;
    }

    const fallbackFields = toFallbackFieldMap(parsedExtraction.data);
    return Object.keys(fallbackFields).length > 0 ? fallbackFields : null;
  } catch (error) {
    console.error('Inbound AI fallback failed', error);
    return null;
  }
}
