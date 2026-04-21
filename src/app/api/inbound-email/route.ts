import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { uploadEmailAttachment } from '@/lib/server/gcs';
import { sendTransactionalEmail } from '@/lib/email';
import { buildReferralLink } from '@/lib/referral-links';
import { logReferralActivity } from '@/lib/server/activities';
import { extractInboundEmailFieldsWithAI } from '@/lib/server/inbound-email-ai-parser';
import { cleanReferralNotes } from '@/lib/server/referral-notes-cleanup';
import { createAdminNotifications } from '@/lib/server/notifications';
import {
  findMcByFirstNameLastInitialToken,
  findMcInFreeText,
  normalizeMcToken
} from '@/lib/server/mc-matcher';
import { parseSignatureHeader, parseSvixSignatures } from './signature';

interface NormalizedAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

interface NormalizedEmail {
  messageId: string;
  from?: string;
  to: string[];
  subject?: string;
  text: string;
  attachments: NormalizedAttachment[];
  receivedAt?: Date;
}

interface ResendAttachmentMetadata {
  id?: string;
  attachment_id?: string;
  filename?: string;
  name?: string;
  content?: string;
  contentType?: string;
  type?: string;
  mime_type?: string;
}

type ResendEmailResponse = Record<string, unknown> & {
  attachments?: ResendAttachmentMetadata[];
};

const CHANNEL_MAP: Record<string, { channel: 'AHA' | 'AHA_OOS'; routeHint: string }> = {
  aha: { channel: 'AHA', routeHint: 'aha' },
  ahaoos: { channel: 'AHA_OOS', routeHint: 'ahaoos' }
};

const CONFIRMATION_RECIPIENT = 'logan.graham@americanfinancing.net';
const RESEND_API_BASE_URL = 'https://api.resend.com';
const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

function decodeSignature(signature: string): Buffer | null {
  const trimmed = signature.trim();
  try {
    const hexBuffer = Buffer.from(trimmed, 'hex');
    if (hexBuffer.length > 0 && hexBuffer.toString('hex') === trimmed.toLowerCase()) {
      return hexBuffer;
    }
  } catch (error) {
    if (error) {
      // continue to base64 attempt
    }
  }
  try {
    const base64Buffer = Buffer.from(trimmed, 'base64');
    return base64Buffer.length > 0 ? base64Buffer : null;
  } catch (error) {
    return null;
  }
}

function verifyResendSignature(
  rawBody: string,
  header: string,
  secret: string,
  fallbackTimestamp?: string
): boolean {
  const parsed = parseSignatureHeader(header, fallbackTimestamp);
  if (!parsed) {
    return false;
  }

  const payload = parsed.timestamp ? `${parsed.timestamp}.${rawBody}` : rawBody;
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest();
  const provided = decodeSignature(parsed.signature);

  if (!provided || provided.length !== expected.length) {
    return false;
  }

  const providedView = new Uint8Array(provided);
  const expectedView = new Uint8Array(expected);

  return crypto.timingSafeEqual(providedView, expectedView);
}

function resolveSvixSecret(secret: string): Uint8Array {
  let bytes: Buffer;
  if (secret.startsWith('whsec_')) {
    const raw = secret.slice('whsec_'.length);
    bytes = Buffer.from(raw, 'base64');
  } else {
    bytes = Buffer.from(secret, 'utf8');
  }
  return Uint8Array.from(bytes);
}

function verifySvixSignature(
  rawBody: string,
  header: string,
  secret: string,
  timestamp?: string,
  messageId?: string
): boolean {
  if (!timestamp || !messageId) {
    return false;
  }

  const signatures = parseSvixSignatures(header);
  if (signatures.length === 0) {
    return false;
  }

  const payload = `${messageId}.${timestamp}.${rawBody}`;
  const secretBuffer = resolveSvixSecret(secret);
  const expectedBase64 = crypto.createHmac('sha256', secretBuffer).update(payload, 'utf8').digest('base64');
  const expected = new TextEncoder().encode(expectedBase64);

  for (const signature of signatures) {
    const provided = new TextEncoder().encode(signature);
    if (provided.length !== expected.length) {
      continue;
    }
    if (crypto.timingSafeEqual(provided, expected)) {
      return true;
    }
  }

  return false;
}

function verifyInboundSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  timestamp?: string,
  svixMessageId?: string
): boolean {
  if (verifyResendSignature(rawBody, signatureHeader, secret, timestamp)) {
    return true;
  }

  return verifySvixSignature(rawBody, signatureHeader, secret, timestamp, svixMessageId);
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/?p\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

function normalizeInboundTextBreaks(text: string): string {
  return text
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/&nbsp;/gi, ' ');
}

function pickEmailAddress(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    const emailValue = (value as { email?: unknown }).email;
    if (typeof emailValue === 'string') {
      return emailValue;
    }
  }
  return undefined;
}

function extractEmailId(payload: Record<string, unknown>): string | null {
  const data = (payload.data as Record<string, unknown>) ?? {};
  const email = (data.email as Record<string, unknown>) ?? {};
  const payloadEmail = (payload.email as Record<string, unknown>) ?? {};

  const candidates: Array<string | null> = [
    typeof data.email_id === 'string' ? data.email_id : null,
    typeof data.emailId === 'string' ? data.emailId : null,
    typeof email.id === 'string' ? email.id : null,
    typeof payload.email_id === 'string' ? payload.email_id : null,
    typeof payloadEmail.id === 'string' ? payloadEmail.id : null
  ];

  const emailId = candidates.find((candidate): candidate is string => Boolean(candidate && candidate.trim()));
  return emailId ? emailId.trim() : null;
}

async function fetchFromResend(
  urls: string[],
  apiKey: string,
  responseType: 'json' | 'arrayBuffer'
): Promise<unknown | ArrayBuffer | null> {
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(responseType === 'json' ? { Accept: 'application/json' } : {})
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        if (response.status >= 500) {
          throw new Error(`Resend API error (${response.status}) at ${url}`);
        }
        if (response.status === 404) {
          continue;
        }
        console.warn('Resend API request failed', { url, status: response.status });
        continue;
      }

      if (responseType === 'json') {
        return (await response.json()) as unknown;
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error('Failed to fetch from Resend API', { url, error });
      continue;
    }
  }
  return null;
}

async function fetchResendReceivedEmail(emailId: string, apiKey: string): Promise<ResendEmailResponse | null> {
  const json = await fetchFromResend(
    [
      `${RESEND_API_BASE_URL}/emails/receiving/${emailId}`,
      `${RESEND_API_BASE_URL}/emails/${emailId}`,
      `${RESEND_API_BASE_URL}/inbound-emails/${emailId}`
    ],
    apiKey,
    'json'
  );

  if (!json || typeof json !== 'object') {
    return null;
  }

  const jsonRecord = json as Record<string, unknown>;
  const data = jsonRecord.data;
  if (data && typeof data === 'object') {
    return data as ResendEmailResponse;
  }

  return json as ResendEmailResponse;
}

async function fetchResendAttachment(
  emailId: string,
  attachmentId: string,
  apiKey: string
): Promise<string | null> {
  const result = await fetchFromResend(
    [
      `${RESEND_API_BASE_URL}/inbound-emails/${emailId}/attachments/${attachmentId}`,
      `${RESEND_API_BASE_URL}/emails/${emailId}/attachments/${attachmentId}`,
      `${RESEND_API_BASE_URL}/attachments/${attachmentId}`
    ],
    apiKey,
    'arrayBuffer'
  );

  if (!(result instanceof ArrayBuffer)) {
    return null;
  }

  const buffer = Buffer.from(result);
  return buffer.toString('base64');
}

async function hydrateEmailFromResend(
  payload: Record<string, unknown>,
  apiKey: string
): Promise<NormalizedEmail | null> {
  const emailId = extractEmailId(payload);
  if (!emailId) {
    return null;
  }

  const email = await fetchResendReceivedEmail(emailId, apiKey);
  if (!email) {
    return null;
  }

  const attachmentsRaw = Array.isArray(email.attachments) ? email.attachments : [];
  const normalizedAttachments: NormalizedAttachment[] = [];

  for (const attachment of attachmentsRaw) {
    if (!attachment || typeof attachment !== 'object') {
      continue;
    }

    const meta = attachment as ResendAttachmentMetadata;
    const filename =
      (typeof meta.filename === 'string' && meta.filename) ||
      (typeof meta.name === 'string' && meta.name) ||
      undefined;

    if (!filename) {
      continue;
    }

    const attachmentId =
      (typeof meta.id === 'string' && meta.id) ||
      (typeof meta.attachment_id === 'string' && meta.attachment_id) ||
      undefined;

    let content = typeof meta.content === 'string' ? meta.content : undefined;

    if (!content && attachmentId) {
      content = await fetchResendAttachment(emailId, attachmentId, apiKey) ?? undefined;
    }

    if (!content) {
      continue;
    }

    const contentType =
      (typeof meta.contentType === 'string' && meta.contentType) ||
      (typeof meta.type === 'string' && meta.type) ||
      (typeof meta.mime_type === 'string' && meta.mime_type) ||
      undefined;

    normalizedAttachments.push({
      filename,
      content,
      contentType
    });
  }

  const payloadData = (payload.data as Record<string, unknown>) ?? {};
  const createdAtCandidate =
    (typeof payloadData.created_at === 'string' && payloadData.created_at) ||
    (typeof payload.created_at === 'string' && payload.created_at) ||
    (typeof payloadData.createdAt === 'string' && payloadData.createdAt) ||
    (typeof payload.createdAt === 'string' && payload.createdAt) ||
    undefined;

  const normalized = normalizeResendPayload({
    ...payload,
    created_at: createdAtCandidate,
    data: {
      ...payloadData,
      email: {
        ...email,
        attachments: normalizedAttachments
      }
    }
  });

  return normalized;
}

function normalizeResendPayload(payload: unknown): NormalizedEmail | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const container = (payload as Record<string, unknown>).data ?? payload;
  const emailCandidate = (container as Record<string, unknown>).email ?? container;
  if (!emailCandidate || typeof emailCandidate !== 'object') {
    return null;
  }

  const email = emailCandidate as Record<string, unknown>;
  const headers = (email.headers as Record<string, unknown>) ?? {};
  const messageIdCandidates: Array<string | null> = [
    typeof email.id === 'string' ? email.id.trim() : null,
    typeof email.messageId === 'string' ? email.messageId.trim() : null,
    typeof (email as Record<string, unknown>)['message_id'] === 'string'
      ? ((email as Record<string, unknown>)['message_id'] as string).trim()
      : null,
    typeof headers['message-id'] === 'string' ? (headers['message-id'] as string).trim() : null,
    typeof headers['Message-Id'] === 'string' ? (headers['Message-Id'] as string).trim() : null
  ];

  const messageId = messageIdCandidates.find((candidate): candidate is string => Boolean(candidate));

  if (!messageId) {
    return null;
  }

  const toRaw = email.to ?? [];
  const to: string[] = Array.isArray(toRaw)
    ? toRaw
        .map((recipient) => pickEmailAddress(recipient) ?? (typeof recipient === 'string' ? recipient : null))
        .filter((value): value is string => Boolean(value))
        .map((value) => value.trim())
    : [];

  const from = pickEmailAddress(email.from);
  const subject = typeof email.subject === 'string' ? email.subject : undefined;

  const textBody =
    (typeof email.text === 'string' && email.text) ||
    (typeof email.text_body === 'string' && email.text_body) ||
    (typeof email.textBody === 'string' && email.textBody) ||
    (typeof email.html === 'string' ? stripHtmlTags(email.html) : '');

  const attachments: NormalizedAttachment[] = [];
  const attachmentsRaw = Array.isArray(email.attachments) ? email.attachments : [];
  for (const attachment of attachmentsRaw) {
    if (!attachment || typeof attachment !== 'object') {
      continue;
    }

    const candidate = attachment as Record<string, unknown>;
    const filename =
      (typeof candidate.filename === 'string' && candidate.filename) ||
      (typeof candidate.name === 'string' && candidate.name);
    if (!filename) {
      continue;
    }

    const content =
      (typeof candidate.content === 'string' && candidate.content) ||
      (typeof candidate.data === 'string' && candidate.data) ||
      (typeof candidate.base64 === 'string' && candidate.base64) ||
      (typeof candidate.content_base64 === 'string' && candidate.content_base64);
    if (!content) {
      continue;
    }

    const contentType =
      (typeof candidate.contentType === 'string' && candidate.contentType) ||
      (typeof candidate.type === 'string' && candidate.type) ||
      undefined;

    attachments.push({
      filename,
      content,
      contentType
    });
  }

  const receivedAtRaw =
    (typeof (payload as Record<string, unknown>).created_at === 'string' && (payload as Record<string, unknown>).created_at) ||
    (typeof (payload as Record<string, unknown>).createdAt === 'string' && (payload as Record<string, unknown>).createdAt);

  const receivedAtCandidate =
    typeof receivedAtRaw === 'string' && receivedAtRaw ? new Date(receivedAtRaw) : undefined;
  const receivedAt = receivedAtCandidate && !Number.isNaN(receivedAtCandidate.getTime()) ? receivedAtCandidate : undefined;

  return {
    messageId,
    from,
    to,
    subject,
    text: textBody ?? '',
    attachments,
    receivedAt
  };
}

function normalizeKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractNestedLabelValue(value: string): { nestedLabel: string; nestedValue: string } | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const nestedMatch = trimmedValue.match(/^(?:\(([^)]+)\)|([^:]+))\s*:\s*(.+)$/);
  if (!nestedMatch) {
    return null;
  }

  const rawNestedLabel = (nestedMatch[1] ?? nestedMatch[2] ?? '').trim();
  const nestedLabel = normalizeKey(rawNestedLabel);
  const nestedValue = (nestedMatch[3] ?? '').trim();
  if (!nestedLabel || !nestedValue) {
    return null;
  }

  return { nestedLabel, nestedValue };
}

function extractLabeledFields(text: string): Record<string, string> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        return acc;
      }
      const label = normalizeKey(line.slice(0, separatorIndex));
      const value = line.slice(separatorIndex + 1).trim();
      if (label) {
        acc[label] = value;
      }

      if (label === 'so' || label === 'en') {
        const nestedPair = extractNestedLabelValue(value);
        if (nestedPair) {
          acc[`${label}${nestedPair.nestedLabel}`] = nestedPair.nestedValue;
          if (nestedPair.nestedLabel === 'endorser' && !acc.endorser) {
            acc.endorser = nestedPair.nestedValue;
          }
        }
      }
      return acc;
    }, {});
}

function parseCurrencyToCents(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const sanitized = value.replace(/[^0-9.]/g, '');
  if (!sanitized) {
    return null;
  }
  const amount = Number.parseFloat(sanitized);
  if (Number.isNaN(amount)) {
    return null;
  }
  return Math.round(amount * 100);
}

function normalizeInboundPhone(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const digits = value.replace(/\D+/g, '');
  const normalizedDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (normalizedDigits.length !== 10) {
    return '';
  }

  return `${normalizedDigits.slice(0, 3)}-${normalizedDigits.slice(3, 6)}-${normalizedDigits.slice(6)}`;
}

function normalizeStageOnTransfer(stageValue: string | undefined, referrerValue: string | undefined): string {
  const normalizedStage = normalizeKey(stageValue ?? '');
  switch (normalizedStage) {
    case 'preapproved':
      return 'Pre-approved';
    case 'preapprovaltbd':
      return 'Pre-approval TBD';
    default:
      break;
  }

  const normalizedReferrer = normalizeKey(referrerValue ?? '');
  if (normalizedReferrer) {
    return normalizedReferrer === 'pncpreapproved' ? 'Pre-approved' : 'Pre-approval TBD';
  }

  return 'Pre-approval TBD';
}

function formatCents(cents: number | null): string {
  if (cents == null) {
    return '';
  }
  return currencyFormatter.format(cents / 100);
}

function formatPhoneForSummary(phoneDigits: string): string {
  if (phoneDigits.length !== 10) {
    return phoneDigits;
  }
  return `${phoneDigits.slice(0, 3)}-${phoneDigits.slice(3, 6)}-${phoneDigits.slice(6)}`;
}

interface ParsedInboundReferralFields {
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  estimatedPriceCents: number | null;
  lookingInZips: string[];
  primaryLookingZip: string;
  borrowerAddress: string;
  stageOnTransfer: string;
  loanType: string;
  source: string;
  endorser: string;
  notes: string;
  mcValue: string;
  loanFileNumber: string;
  clientType: 'Seller' | 'Buyer';
  hasRequiredFields: boolean;
}

function parseInboundReferralFields(fields: Record<string, string>): ParsedInboundReferralFields {
  const firstName = (fields.first || fields.firstname || '').trim();
  const lastName = (fields.last || fields.lastname || '').trim();
  const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const borrowerName = (combinedName || fields.fullname || '').trim();
  const borrowerEmail = (fields.borroweremail || fields.email || '').trim().toLowerCase();
  const borrowerPhone = normalizeInboundPhone((fields.phone || fields.borrowerphone || '').trim());
  const estimatedPriceCents = parseCurrencyToCents(
    (fields.estimatedprice || fields.estimatedpurchaseprice || fields.price || '').trim()
  );
  const lookingInZipRaw = (fields.ziplookingin || fields.zipcode || fields.zip || fields.area || '').trim();
  const lookingInZips = Array.from(
    new Set(
      lookingInZipRaw
        .split(/[,\s]+/)
        .map((value) => value.replace(/[^0-9]/g, '').slice(0, 5))
        .filter((zip) => zip.length === 5)
    )
  );
  const primaryLookingZip = lookingInZips[0] ?? '';
  const borrowerAddress = (fields.borroweraddress || fields.selleraddress || '').trim();
  const stageOnTransfer = normalizeStageOnTransfer(fields.stageontransfer, fields.referrer);
  const loanType = (fields.loantype || '').trim();
  const sourceCandidate = (
    fields.sosource ||
    fields.referralsource ||
    fields.leadsource ||
    ''
  ).trim();
  const sourceRaw = (fields.source || '').trim();
  const sourceTypeRaw = sourceRaw.toLowerCase();
  const source =
    sourceCandidate ||
    (sourceTypeRaw === 'mc' || sourceTypeRaw === 'mortgage consultant'
      ? 'MC'
      : sourceTypeRaw === 'lender'
        ? 'Lender'
        : '');
  const endorser = (fields.endorser || fields.enendorser || '').trim();
  const notes = (fields.notes || '').trim();
  const mcValue = (fields.mc || fields.source || '').trim();
  const rawLoanDigits = (fields.loannumber || fields.loannum || '').replace(/\D+/g, '');
  const loanFileNumber = rawLoanDigits.slice(0, 11);
  const clientTypeRaw = (fields.dealtype || '').toLowerCase();
  const clientType: 'Seller' | 'Buyer' = clientTypeRaw.includes('sell') ? 'Seller' : 'Buyer';

  const hasRequiredFields =
    Boolean(borrowerName) &&
    Boolean(borrowerEmail) &&
    borrowerEmail.includes('@') &&
    Boolean(borrowerPhone) &&
    lookingInZips.length > 0 &&
    Boolean(loanFileNumber);

  return {
    borrowerName,
    borrowerEmail,
    borrowerPhone,
    estimatedPriceCents,
    lookingInZips,
    primaryLookingZip,
    borrowerAddress,
    stageOnTransfer,
    loanType,
    source,
    endorser,
    notes,
    mcValue,
    loanFileNumber,
    clientType,
    hasRequiredFields
  };
}

function sanitizeFileName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function normalizeRouteHint(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractRouteHint(to: string[]): { channel: 'AHA' | 'AHA_OOS'; routeHint: string } | null {
  for (const recipient of to) {
    const emailAddressMatch = recipient.match(/<([^>]+)>/);
    const emailAddress = emailAddressMatch ? emailAddressMatch[1] : recipient;
    if (!emailAddress || !emailAddress.includes('@')) {
      continue;
    }

    const [localPartRaw] = emailAddress.split('@');
    if (!localPartRaw) {
      continue;
    }

    const localPart = localPartRaw.toLowerCase();
    const plusIndex = localPart.indexOf('+');
    const candidates = new Set<string>();

    if (plusIndex !== -1 && plusIndex < localPart.length - 1) {
      candidates.add(localPart.slice(plusIndex + 1));
    }

    candidates.add(localPart);
    localPart.split(/[._-]+/).forEach((segment) => {
      if (segment) {
        candidates.add(segment);
      }
    });

    for (const candidate of candidates) {
      const normalized = normalizeRouteHint(candidate);
      if (!normalized) {
        continue;
      }
      const channelInfo = CHANNEL_MAP[normalized];
      if (channelInfo) {
        return channelInfo;
      }
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function resolveInboundSecret(): string | undefined {
  return (
    process.env.RESEND_INBOUND_SECRET ||
    process.env.RESEND_INBOUND_WEBHOOK_SECRET ||
    process.env.RESEND_WEBHOOK_SECRET
  );
}

function resolveSignatureHeader(request: NextRequest): string | null {
  const headerNames = ['resend-signature', 'x-resend-signature', 'svix-signature'];
  for (const name of headerNames) {
    const value = request.headers.get(name);
    if (value) {
      return value;
    }
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = resolveInboundSecret();
  if (!secret) {
    return NextResponse.json({ error: 'Inbound email signing secret is not configured.' }, { status: 500 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Resend API key is not configured.' }, { status: 500 });
  }

  const signatureHeader = resolveSignatureHeader(request);
  if (!signatureHeader) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const timestampHeader =
    request.headers.get('resend-timestamp') ??
    request.headers.get('x-resend-timestamp') ??
    request.headers.get('svix-timestamp') ??
    undefined;
  const svixMessageId = request.headers.get('svix-id') ?? undefined;
  const rawBody = await request.text();

  if (!verifyInboundSignature(rawBody, signatureHeader, secret, timestampHeader, svixMessageId)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (error) {
    return NextResponse.json({ error: 'Unable to parse inbound email payload.' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'Inbound email payload is malformed.' }, { status: 400 });
  }

  const payloadRecord = payload as Record<string, unknown>;
  const eventType = typeof payloadRecord.type === 'string' ? payloadRecord.type : '';
  if (eventType !== 'email.received') {
    return NextResponse.json({ status: 'ignored', reason: 'event_type_unhandled' }, { status: 202 });
  }

  const email = await hydrateEmailFromResend(payloadRecord, apiKey);
  if (!email) {
    return NextResponse.json({ error: 'Inbound email payload is missing required fields.' }, { status: 400 });
  }

  const channelInfo = extractRouteHint(email.to);
  if (!channelInfo) {
    return NextResponse.json({ status: 'ignored', reason: 'route_hint_unmatched' }, { status: 202 });
  }

  const extractedFields = extractLabeledFields(normalizeInboundTextBreaks(email.text));
  let parsedFields = parseInboundReferralFields(extractedFields);
  let aiFallbackAttempted = false;
  let aiFallbackApplied = false;

  if (!parsedFields.hasRequiredFields) {
    aiFallbackAttempted = true;
    const aiFallbackFields = await extractInboundEmailFieldsWithAI({
      text: email.text,
      subject: email.subject,
      from: email.from,
      to: email.to
    });

    if (aiFallbackFields) {
      const mergedFields = {
        ...aiFallbackFields,
        ...extractedFields
      };
      parsedFields = parseInboundReferralFields(mergedFields);
      aiFallbackApplied = true;
    }
  }

  const {
    borrowerName,
    borrowerEmail,
    borrowerPhone,
    estimatedPriceCents,
    lookingInZips,
    primaryLookingZip,
    borrowerAddress,
    stageOnTransfer,
    loanType,
    source,
    endorser,
    notes,
    mcValue,
    loanFileNumber,
    clientType,
    hasRequiredFields
  } = parsedFields;

  if (!hasRequiredFields) {
    if (aiFallbackAttempted) {
      console.warn('Inbound email referral parse failed after AI fallback attempt', {
        messageId: email.messageId,
        aiFallbackApplied
      });
    }
    return NextResponse.json({ error: 'Inbound email is missing borrower contact details or loan number.' }, { status: 400 });
  }

  await connectMongo();

  const existingReferral = await Referral.findOne({ 'inboundEmail.messageId': email.messageId }).select('_id');
  if (existingReferral) {
    return NextResponse.json({ status: 'duplicate' }, { status: 202 });
  }

  let matchedLenderId: Types.ObjectId | undefined;
  let matchedLenderName = '';
  let matchedFromFreeText = false;
  if (mcValue) {
    const token = normalizeMcToken(mcValue);
    if (token) {
      try {
        const match = await findMcByFirstNameLastInitialToken(token);
        if (match && 'id' in match) {
          matchedLenderId = match.id;
          matchedLenderName = match.name;
        } else if (match && 'ambiguous' in match) {
          console.warn('Inbound email MC source ambiguous', {
            messageId: email.messageId,
            mcValue,
            candidateIds: match.candidateIds,
            reason: 'ambiguous_match'
          });
        } else {
          console.warn('Inbound email MC source unmatched', {
            messageId: email.messageId,
            mcValue,
            reason: 'no_match'
          });
        }
      } catch (error) {
        console.error('Failed to match inbound email MC source', {
          messageId: email.messageId,
          mcValue,
          error: error instanceof Error ? error.message : 'unknown_error'
        });
      }
    }
  }

  if (!matchedLenderId) {
    try {
      const freeTextMatch = await findMcInFreeText(email.text);
      if (freeTextMatch && 'id' in freeTextMatch) {
        matchedLenderId = freeTextMatch.id;
        matchedLenderName = freeTextMatch.name;
        matchedFromFreeText = true;
      } else if (freeTextMatch && 'ambiguous' in freeTextMatch) {
        console.warn('Inbound email MC free-text scan ambiguous', {
          messageId: email.messageId,
          candidateIds: freeTextMatch.candidateIds,
          reason: 'ambiguous_free_text_match'
        });
      }
    } catch (error) {
      console.error('Failed to scan inbound email for MC token', {
        messageId: email.messageId,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  }

  const attachmentUploads = await Promise.all(
    email.attachments.map(async (attachment, index) => {
      if (!attachment.content) {
        return null;
      }
      try {
        let base64Content = attachment.content.trim();
        const dataUriIndex = base64Content.indexOf(',');
        if (dataUriIndex !== -1 && base64Content.slice(0, dataUriIndex).toLowerCase().includes('base64')) {
          base64Content = base64Content.slice(dataUriIndex + 1);
        }
        const buffer = Buffer.from(base64Content, 'base64');
        const safeName = sanitizeFileName(attachment.filename) || `attachment-${index + 1}`;
        const key = `inbound/${channelInfo.routeHint}/${email.messageId}/${Date.now()}-${safeName}`;
        if (buffer.length === 0) {
          return null;
        }
        const body = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const url = await uploadEmailAttachment({
          key,
          body,
          contentType: attachment.contentType,
          messageId: email.messageId
        });
        if (!url) {
          return null;
        }
        return {
          name: attachment.filename,
          url
        };
      } catch (error) {
        console.error('Failed to process inbound attachment', {
          messageId: email.messageId,
          index
        });
        return null;
      }
    })
  );

  const attachments = attachmentUploads.filter((item): item is { name: string; url: string } => Boolean(item));

  const cleanedNotes = notes
    ? await cleanReferralNotes(notes, {
        allowFallbackToOriginal: true
      })
    : '';

  const notesSections: string[] = [];
  if (matchedLenderName) {
    const suffix = matchedFromFreeText
      ? ' (detected in email body)'
      : mcValue
        ? ` (source: ${mcValue})`
        : '';
    notesSections.push(`MC: ${matchedLenderName}${suffix}`);
  } else if (mcValue) {
    notesSections.push(`MC: ${mcValue}`);
  }
  if (cleanedNotes) {
    notesSections.push(cleanedNotes);
  }
  const initialNotes = notesSections.filter(Boolean).join('\n\n');

  try {
    const referral = await Referral.create({
      source,
      endorser,
      clientType,
      borrower: {
        name: borrowerName,
        email: borrowerEmail,
        phone: borrowerPhone
      },
      lookingInZip: primaryLookingZip,
      lookingInZips,
      borrowerCurrentAddress: borrowerAddress,
      stageOnTransfer,
      initialNotes,
      loanFileNumber,
      loanType,
      preApprovalAmountCents: estimatedPriceCents ?? undefined,
      estPurchasePriceCents: estimatedPriceCents ?? undefined,
      attachments,
      notes: cleanedNotes
        ? [
            {
              authorRole: 'system',
              authorName: 'Inbound Email Import',
              content: cleanedNotes,
              hiddenFromAgent: false,
              hiddenFromMc: false,
              createdAt: new Date(),
              emailedTargets: []
            }
          ]
        : [],
      lender: matchedLenderId,
      org: 'AHA',
      ahaBucket: channelInfo.channel,
      inboundEmail: {
        messageId: email.messageId,
        routeHint: channelInfo.routeHint,
        channel: channelInfo.channel,
        receivedAt: email.receivedAt ?? new Date(),
        from: email.from,
        subject: email.subject
      }
    });

    const summaryFields = [
      `Deal Type: ${clientType}`,
      `Zip${lookingInZips.length > 1 ? 's' : ''}: ${lookingInZips.join(', ')}`,
      `Stage: ${stageOnTransfer}`,
      source ? `Source: ${source}` : null,
      endorser ? `Endorser: ${endorser}` : null,
      matchedLenderName
        ? matchedFromFreeText
          ? `MC: ${matchedLenderName} (detected in email body)`
          : mcValue
            ? `MC: ${matchedLenderName} (source: ${mcValue})`
            : `MC: ${matchedLenderName}`
        : mcValue
          ? `MC: ${mcValue}`
          : null,
      borrowerEmail ? `Email: ${borrowerEmail}` : null,
      borrowerPhone ? `Phone: ${formatPhoneForSummary(borrowerPhone)}` : null,
      loanFileNumber ? `Loan Number: ${loanFileNumber}` : null,
      loanType ? `Loan Type: ${loanType}` : null,
      estimatedPriceCents != null ? `Pre-approval Amount: ${formatCents(estimatedPriceCents)}` : null,
      borrowerAddress ? `Seller Address: ${borrowerAddress}` : null,
      cleanedNotes ? `Notes: ${cleanedNotes}` : null,
      `Channel: ${channelInfo.channel}`,
      `Route Hint: ${channelInfo.routeHint}`
    ].filter(Boolean) as string[];

    const activityPromises: Promise<unknown>[] = [
      logReferralActivity({
        referralId: referral._id,
        actorRole: 'system',
        channel: 'update',
        content: `Created referral for ${borrowerName || 'a new client'} via inbound email import`
      }),
      createAdminNotifications({
        type: 'referral_created',
        referralId: referral._id,
        borrowerName: borrowerName || 'New Referral',
        actorRole: 'System',
        actorName: 'Inbound Email Import',
        content: `New inbound referral created for ${borrowerName || 'a new client'}.`
      })
    ];

    if (matchedLenderId && matchedLenderName) {
      const assignmentSummary = matchedFromFreeText
        ? `Auto-assigned mortgage consultant ${matchedLenderName} (detected in inbound email body)`
        : `Auto-assigned mortgage consultant ${matchedLenderName} from inbound email source "${mcValue}"`;
      activityPromises.push(
        logReferralActivity({
          referralId: referral._id,
          actorRole: 'system',
          channel: 'update',
          content: assignmentSummary
        })
      );
    }

    await Promise.allSettled(activityPromises);

    const borrowerLabel = escapeHtml(borrowerName);
    const summaryHtml = `
      <p>Referral received for <strong>${borrowerLabel}</strong>.</p>
      <ul>
        ${summaryFields.map((field) => `<li>${escapeHtml(field)}</li>`).join('')}
      </ul>
    `;
    const summaryText = [`Referral received for ${borrowerName}.`, ...summaryFields].join('\n');

    await sendTransactionalEmail({
      to: [CONFIRMATION_RECIPIENT],
      subject: `Referral received: ${borrowerName} (${channelInfo.channel})`,
      html: summaryHtml,
      text: summaryText
    });

    // Send email notification to kristen.truong@americanhomeagents.com
    (async () => {
      try {
        const referralLink = buildReferralLink(referral._id.toString());
        const borrowerLabel = escapeHtml(borrowerName);
        const notificationHtml = `
          <p>A new referral has been created for <strong>${borrowerLabel}</strong>.</p>
          <ul>
            ${summaryFields.map((field) => `<li>${escapeHtml(field)}</li>`).join('')}
          </ul>
          <p><a href="${referralLink}">View the referral</a></p>
        `;
        const notificationText = `A new referral has been created for ${borrowerName}.\n\n${summaryFields.join('\n')}\n\nView the referral: ${referralLink}`;

        await sendTransactionalEmail({
          to: ['kristen.truong@americanhomeagents.com'],
          subject: `New Referral: ${borrowerName}`,
          html: notificationHtml,
          text: notificationText
        });
      } catch (error) {
        console.error('Failed to send new referral notification email', error);
      }
    })().catch((error) => {
      console.error('Failed to send new referral notification email', error);
    });

    return NextResponse.json({ status: 'created', referralId: referral._id.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('duplicate key')) {
      return NextResponse.json({ status: 'duplicate' }, { status: 202 });
    }
    console.error('Failed to persist inbound referral', {
      messageId: email.messageId,
      error: message
    });
    return NextResponse.json({ error: 'Failed to create referral record.' }, { status: 500 });
  }
}
