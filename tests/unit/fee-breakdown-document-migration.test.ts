import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';

import {
  buildServerDocumentPayload,
  decideServerDocumentWrite,
  readSourcePdfDocuments,
  verifyReadBackDocument,
} from '@/lib/server/fee-breakdown-document-migration';
import type { FeeBreakdownDocumentDefinition } from '@/lib/server/fee-breakdown-documents';

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function definition(filename: string, content: Buffer): FeeBreakdownDocumentDefinition {
  return {
    key: `fee-breakdown/${filename}`,
    version: 'test-v1',
    filename,
    mimeType: 'application/pdf',
    byteLength: content.length,
    sha256: sha256(content),
  };
}

describe('fee breakdown document migration helpers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fee-documents-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads source PDFs without mutating them and validates signatures, sizes, and hashes', () => {
    const content = Buffer.from('%PDF-1.7\nwiring\n');
    const doc = definition('AHA Commission Wiring Instructions.pdf', content);
    const sourcePath = path.join(tempDir, doc.filename);
    fs.writeFileSync(sourcePath, content);

    const before = fs.readFileSync(sourcePath);
    const sources = readSourcePdfDocuments([doc], tempDir);
    const after = fs.readFileSync(sourcePath);

    expect(sources).toHaveLength(1);
    expect(sources[0].definition).toEqual(doc);
    expect(sources[0].content).toEqual(content);
    expect(after).toEqual(before);
  });

  it('rejects invalid PDF signatures before upload planning', () => {
    const badContent = Buffer.from('not a pdf');
    const doc = {
      ...definition('AHA W9 2026.pdf', Buffer.from('%PDF-1.7\nw9\n')),
      byteLength: badContent.length,
      sha256: sha256(badContent),
    };
    fs.writeFileSync(path.join(tempDir, doc.filename), badContent);

    expect(() => readSourcePdfDocuments([doc], tempDir)).toThrow(
      'Source file is not a PDF: AHA W9 2026.pdf'
    );
  });

  it('uploads missing documents and skips identical stored versions', () => {
    const content = Buffer.from('%PDF-1.7\nw9\n');
    const doc = definition('AHA W9 2026.pdf', content);
    const payload = buildServerDocumentPayload(doc, content, new Date('2026-01-02T00:00:00Z'));

    expect(decideServerDocumentWrite(doc, null)).toEqual({ action: 'upload' });
    expect(decideServerDocumentWrite(doc, payload)).toEqual({ action: 'skip' });
  });

  it('refuses to overwrite different existing content silently', () => {
    const content = Buffer.from('%PDF-1.7\nw9\n');
    const differentContent = Buffer.from('%PDF-1.7\ndifferent\n');
    const doc = definition('AHA W9 2026.pdf', content);
    const differentPayload = {
      ...buildServerDocumentPayload(doc, differentContent, new Date('2026-01-02T00:00:00Z')),
      byteLength: differentContent.length,
      sha256: sha256(differentContent),
    };

    expect(() => decideServerDocumentWrite(doc, differentPayload)).toThrow(
      'Existing stored document differs from source: AHA W9 2026.pdf'
    );
  });

  it('verifies read-back byte-for-byte integrity', () => {
    const content = Buffer.from('%PDF-1.7\nw9\n');
    const doc = definition('AHA W9 2026.pdf', content);
    const payload = buildServerDocumentPayload(doc, content, new Date('2026-01-02T00:00:00Z'));

    expect(() => verifyReadBackDocument(doc, payload, content)).not.toThrow();
    expect(() => verifyReadBackDocument(doc, payload, Buffer.from('%PDF-1.7\nchanged\n'))).toThrow(
      'Read-back verification failed for AHA W9 2026.pdf'
    );
  });

  it('verifies BSON Binary-style read-back content', () => {
    const content = Buffer.from('%PDF-1.7\nw9\n');
    const doc = definition('AHA W9 2026.pdf', content);
    const payload = {
      ...buildServerDocumentPayload(doc, content, new Date('2026-01-02T00:00:00Z')),
      content: { buffer: content } as any,
    };

    expect(() => verifyReadBackDocument(doc, payload, content)).not.toThrow();
  });
});
