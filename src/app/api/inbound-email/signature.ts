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
