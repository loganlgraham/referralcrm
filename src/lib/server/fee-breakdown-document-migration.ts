import fs from 'fs';
import path from 'path';

import {
  calculateSha256,
  FeeBreakdownDocumentError,
  hasPdfSignature,
  toPdfBuffer,
  type FeeBreakdownDocumentDefinition,
  type StoredBinaryContent,
} from '@/lib/server/fee-breakdown-documents';

export type SourcePdfDocument = {
  definition: FeeBreakdownDocumentDefinition;
  content: Buffer;
};

export type ServerDocumentPayload = FeeBreakdownDocumentDefinition & {
  content: StoredBinaryContent;
  uploadedAt: Date;
};

export type DocumentWriteDecision = { action: 'upload' } | { action: 'skip' };

export function readSourcePdfDocuments(
  documents: readonly FeeBreakdownDocumentDefinition[],
  sourceDir: string
): SourcePdfDocument[] {
  return documents.map((definition) => {
    const sourcePath = path.join(sourceDir, definition.filename);
    const content = fs.readFileSync(sourcePath);
    const byteLength = content.length;
    const sha256 = calculateSha256(content);

    if (!hasPdfSignature(content)) {
      throw new FeeBreakdownDocumentError(`Source file is not a PDF: ${definition.filename}`);
    }
    if (byteLength !== definition.byteLength) {
      throw new FeeBreakdownDocumentError(`Source file byte length mismatch: ${definition.filename}`);
    }
    if (sha256 !== definition.sha256) {
      throw new FeeBreakdownDocumentError(`Source file SHA-256 mismatch: ${definition.filename}`);
    }

    return { definition, content };
  });
}

export function buildServerDocumentPayload(
  definition: FeeBreakdownDocumentDefinition,
  content: Buffer,
  uploadedAt: Date
): ServerDocumentPayload {
  return {
    ...definition,
    content,
    byteLength: content.length,
    sha256: calculateSha256(content),
    uploadedAt,
  };
}

export function decideServerDocumentWrite(
  definition: FeeBreakdownDocumentDefinition,
  existing: Pick<ServerDocumentPayload, 'filename' | 'mimeType' | 'byteLength' | 'sha256'> | null
): DocumentWriteDecision {
  if (!existing) {
    return { action: 'upload' };
  }

  if (
    existing.filename === definition.filename &&
    existing.mimeType === definition.mimeType &&
    existing.byteLength === definition.byteLength &&
    existing.sha256 === definition.sha256
  ) {
    return { action: 'skip' };
  }

  throw new FeeBreakdownDocumentError(`Existing stored document differs from source: ${definition.filename}`);
}

export function verifyReadBackDocument(
  definition: FeeBreakdownDocumentDefinition,
  readBack: Pick<ServerDocumentPayload, 'content' | 'byteLength' | 'sha256' | 'mimeType' | 'filename'> | null,
  sourceContent: Buffer
): void {
  if (!readBack) {
    throw new FeeBreakdownDocumentError(`Read-back verification failed for ${definition.filename}: document missing`);
  }

  const content = toPdfBuffer(readBack.content, definition.filename);
  const sameBytes = content.equals(sourceContent as unknown as Uint8Array);
  const sameMetadata =
    readBack.filename === definition.filename &&
    readBack.mimeType === definition.mimeType &&
    readBack.byteLength === sourceContent.length &&
    readBack.sha256 === calculateSha256(sourceContent);

  if (!sameBytes || !sameMetadata) {
    throw new FeeBreakdownDocumentError(`Read-back verification failed for ${definition.filename}`);
  }
}
