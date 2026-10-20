import crypto from 'crypto';

interface ParsedSignature {
  signature: string;
  timestamp?: string;
}

function sanitizeSvixSignature(value: string): string | undefined {
  const trimmed = value.replace(/^"|"$/g, '').trim();
  if (!trimmed) {
    return undefined;
  }

  const [version, signature] = trimmed.split(',', 2);
  if (!version?.startsWith('v') || !signature) {
    return undefined;
  }

  const sanitized = signature.replace(/^"|"$/g, '').trim();
  return sanitized ? sanitized : undefined;
}

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

export function parseSignatureHeader(
  header: string,
  fallbackTimestamp?: string
): ParsedSignature | null {
  if (!header) {
    return null;
  }

  if (header.includes(',')) {
    const svixSignature = sanitizeSvixSignature(header);
    if (svixSignature) {
      return {
        signature: svixSignature,
        timestamp: sanitizeSignatureComponent(fallbackTimestamp)
      };
    }

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

export function parseSvixSignatures(header: string): string[] {
  if (!header) {
    return [];
  }

  return header
    .split(/\s+/)
    .map((entry) => sanitizeSvixSignature(entry))
    .filter((value): value is string => Boolean(value));
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

/**
 * Resend has shipped both its own signature header format and Svix's, so accept either.
 */
export function verifyResendWebhookSignature(
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

export function resolveResendSignatureHeader(headers: Headers): string | null {
  const headerNames = ['resend-signature', 'x-resend-signature', 'svix-signature'];
  for (const name of headerNames) {
    const value = headers.get(name);
    if (value) {
      return value;
    }
  }
  return null;
}

export function resolveResendTimestampHeader(headers: Headers): string | undefined {
  return (
    headers.get('resend-timestamp') ??
    headers.get('x-resend-timestamp') ??
    headers.get('svix-timestamp') ??
    undefined
  );
}
