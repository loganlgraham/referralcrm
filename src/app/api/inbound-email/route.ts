import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { uploadEmailAttachment } from '@/lib/server/gcs';
import { sendTransactionalEmail } from '@/lib/email';

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

function sanitizeSignatureComponent(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const sanitized = value.replace(/^"|"$/g, '').trim();
  return sanitized ? sanitized : undefined;
}

function splitSignaturePair(pair: string): [string, string] | null {
  const delimiterIndex = pair.indexOf('=');
  if (delimiterIndex === -1) {
    return null;
  }

  const key = pair.slice(0, delimiterIndex);
  const value = pair.slice(delimiterIndex + 1);
  if (!key) {
    return null;
  }

  return [key, value];
}

export function parseSignatureHeader(header: string, fallbackTimestamp?: string): {
  signature: string;
  timestamp?: string;
} | null {
  if (!header) {
    return null;
  }

  if (header.includes(',')) {
    const parts = header
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => splitSignaturePair(pair))
      .filter(
        (entry): entry is [string, string] => Array.isArray(entry) && entry.length === 2
      );
    const map = Object.fromEntries(
      parts.map(([key, value]) => [key, sanitizeSignatureComponent(value)])
    );
    const signature = sanitizeSignatureComponent(map.v1);
    const timestamp =
      sanitizeSignatureComponent(map.t) ?? sanitizeSignatureComponent(fallbackTimestamp);
    if (!signature) {
      return null;
    }
    return { signature, timestamp };
  }

  const signatureOnly = sanitizeSignatureComponent(header);
  if (!signatureOnly) {
    return null;
  }

  return {
    signature: signatureOnly,
    timestamp: sanitizeSignatureComponent(fallbackTimestamp)
  };
}

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
      `${RESEND_API_BASE_URL}/inbound-emails/${emailId}`,
      `${RESEND_API_BASE_URL}/emails/${emailId}`
    ],
    apiKey,
    'json'
  );

  if (!json || typeof json !== 'object') {
    return null;
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
  const headerNames = ['resend-signature', 'x-resend-signature'];
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
    request.headers.get('resend-timestamp') ?? request.headers.get('x-resend-timestamp') ?? undefined;
  const rawBody = await request.text();

  if (!verifyResendSignature(rawBody, signatureHeader, secret, timestampHeader)) {
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

  const fields = extractLabeledFields(email.text);
  const firstName = (fields.first || fields.firstname || '').trim();
  const lastName = (fields.last || fields.lastname || '').trim();
  const combinedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const borrowerName = (combinedName || fields.fullname || '').trim();
  const borrowerEmail = (fields.borroweremail || fields.email || '').trim().toLowerCase();
  const borrowerPhone = (fields.phone || fields.borrowerphone || '').trim();
  const estimatedPriceCents = parseCurrencyToCents(
    (fields.estimatedprice || fields.estimatedpurchaseprice || fields.price || '').trim()
  );
  const lookingInZipRaw = (fields.ziplookingin || fields.zip || '').trim();
  const lookingInZip = lookingInZipRaw.replace(/[^0-9]/g, '');
  const borrowerAddress = (fields.borroweraddress || '').trim();
  const stageOnTransfer = (fields.stageontransfer || '').trim();
  const loanType = (fields.loantype || '').trim();
  const sourceRaw = (fields.source || '').trim().toLowerCase();
  const source = sourceRaw === 'mc' || sourceRaw === 'mortgage consultant' ? 'MC' : 'Lender';
  const endorser = (fields.endorser || '').trim();
  const notes = (fields.notes || '').trim();
  const mcValue = (fields.mc || '').trim();
  const loanFileNumber = (fields.loannumber || fields.loannum || '').trim();
  const clientTypeRaw = (fields.dealtype || '').toLowerCase();
  const clientType: 'Seller' | 'Buyer' = clientTypeRaw.includes('sell') ? 'Seller' : 'Buyer';

  if (!borrowerName || !borrowerEmail || !borrowerEmail.includes('@') || !borrowerPhone || !lookingInZip || !loanFileNumber) {
    return NextResponse.json({ error: 'Inbound email is missing borrower contact details or loan number.' }, { status: 400 });
  }

  await connectMongo();

  const existingReferral = await Referral.findOne({ 'inboundEmail.messageId': email.messageId }).select('_id');
  if (existingReferral) {
    return NextResponse.json({ status: 'duplicate' }, { status: 202 });
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

  const notesSections: string[] = [];
  if (mcValue) {
    notesSections.push(`MC: ${mcValue}`);
  }
  if (notes) {
    notesSections.push(notes);
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
      lookingInZip,
      borrowerCurrentAddress: borrowerAddress,
      stageOnTransfer,
      initialNotes,
      loanFileNumber,
      loanType,
      estPurchasePriceCents: estimatedPriceCents ?? undefined,
      attachments,
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
      `Zip: ${lookingInZip}`,
      mcValue ? `MC: ${mcValue}` : null,
      stageOnTransfer ? `Stage: ${stageOnTransfer}` : null
    ].filter(Boolean) as string[];

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
