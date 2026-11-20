import { createHash } from 'crypto';

import { ServerDocument } from '@/models/server-document';

export type FeeBreakdownDocumentDefinition = {
  key: string;
  version: string;
  filename: string;
  mimeType: 'application/pdf';
  byteLength: number;
  sha256: string;
};

type StoredPdfDocument = {
  key?: string | null;
  version?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  content?: StoredBinaryContent | null;
  byteLength?: number | null;
  sha256?: string | null;
  uploadedAt?: Date | string | null;
};

export type StoredBinaryContent = Buffer | Uint8Array | { buffer: Buffer | Uint8Array };

export type FeeBreakdownAttachment = {
  filename: string;
  content: Buffer;
};

export class FeeBreakdownDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeBreakdownDocumentError';
  }
}

export const FEE_BREAKDOWN_DOCUMENTS: readonly FeeBreakdownDocumentDefinition[] = [
  {
    key: 'fee-breakdown/aha-commission-wiring-instructions',
    version: '2026-01',
    filename: 'AHA Commission Wiring Instructions.pdf',
    mimeType: 'application/pdf',
    byteLength: 201710,
    sha256: 'b35c5b5e4a12c4d4024bb66c973bcee6c4ea17d844a1b71b1bbc24875d84f547',
  },
  {
    key: 'fee-breakdown/aha-w9-2026',
    version: '2026-01',
    filename: 'AHA W9 2026.pdf',
    mimeType: 'application/pdf',
    byteLength: 573953,
    sha256: '697b580effdfc1c54593c6948ace79fad108dd5c1db11c606b8c571befb092a6',
  },
] as const;

export function calculateSha256(content: Buffer): string {
  return createHash('sha256').update(content as unknown as Uint8Array).digest('hex');
}

export function hasPdfSignature(content: Buffer): boolean {
  return content.length >= 5 && content.subarray(0, 5).toString('ascii') === '%PDF-';
}

export function toPdfBuffer(value: StoredBinaryContent | null | undefined, filename: string): Buffer {
  if (!value) {
    throw new FeeBreakdownDocumentError(`Stored document has no content: ${filename}`);
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(Array.from(value));
  }
  return Buffer.isBuffer(value.buffer) ? value.buffer : Buffer.from(Array.from(value.buffer));
}

export function validateStoredPdfDocument(
  document: StoredPdfDocument,
  expected: FeeBreakdownDocumentDefinition
): FeeBreakdownAttachment {
  const content = toPdfBuffer(document.content, expected.filename);
  const actualSha256 = calculateSha256(content);

  if (document.key !== expected.key) {
    throw new FeeBreakdownDocumentError(`Stored document key mismatch: ${expected.filename}`);
  }
  if (document.version !== expected.version) {
    throw new FeeBreakdownDocumentError(`Stored document version mismatch: ${expected.filename}`);
  }
  if (document.filename !== expected.filename) {
    throw new FeeBreakdownDocumentError(`Stored document filename mismatch: ${expected.filename}`);
  }
  if (document.mimeType !== expected.mimeType) {
    throw new FeeBreakdownDocumentError(`Stored document MIME type mismatch: ${expected.filename}`);
  }
  if (!hasPdfSignature(content)) {
    throw new FeeBreakdownDocumentError(`Stored document does not have a PDF signature: ${expected.filename}`);
  }
  if (document.byteLength !== content.length || content.length !== expected.byteLength) {
    throw new FeeBreakdownDocumentError(`Stored document byte length mismatch: ${expected.filename}`);
  }
  if (document.sha256 !== actualSha256 || actualSha256 !== expected.sha256) {
    throw new FeeBreakdownDocumentError(`Stored document SHA-256 mismatch: ${expected.filename}`);
  }

  return {
    filename: expected.filename,
    content,
  };
}

export async function loadFeeBreakdownAttachments(
  documents: readonly FeeBreakdownDocumentDefinition[] = FEE_BREAKDOWN_DOCUMENTS
): Promise<FeeBreakdownAttachment[]> {
  const attachments: FeeBreakdownAttachment[] = [];

  for (const expected of documents) {
    let document: StoredPdfDocument | null;
    try {
      document = await ServerDocument.findOne({
        key: expected.key,
        version: expected.version,
      }).lean<StoredPdfDocument | null>();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown database error';
      throw new FeeBreakdownDocumentError(`Unable to load fee breakdown attachments: ${message}`);
    }

    if (!document) {
      throw new FeeBreakdownDocumentError(`Fee breakdown attachment is missing: ${expected.filename}`);
    }

    attachments.push(validateStoredPdfDocument(document, expected));
  }

  return attachments;
}
