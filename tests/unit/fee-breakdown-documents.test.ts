import { createHash } from 'crypto';

import { ServerDocument } from '@/models/server-document';
import {
  FeeBreakdownDocumentError,
  loadFeeBreakdownAttachments,
  validateStoredPdfDocument,
  type FeeBreakdownDocumentDefinition,
} from '@/lib/server/fee-breakdown-documents';

jest.mock('@/models/server-document', () => ({
  ServerDocument: {
    findOne: jest.fn(),
  },
}));

const mockedFindOne = ServerDocument.findOne as jest.Mock;

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function definition(
  key: string,
  filename: string,
  content: Buffer
): FeeBreakdownDocumentDefinition {
  return {
    key,
    version: 'test-v1',
    filename,
    mimeType: 'application/pdf',
    byteLength: content.length,
    sha256: sha256(content),
  };
}

function storedDocument(expected: FeeBreakdownDocumentDefinition, content = Buffer.from('%PDF-1.7\nvalid\n')) {
  return {
    key: expected.key,
    version: expected.version,
    filename: expected.filename,
    mimeType: expected.mimeType,
    byteLength: content.length,
    sha256: sha256(content),
    content,
    uploadedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('fee breakdown document loader', () => {
  beforeEach(() => {
    mockedFindOne.mockReset();
  });

  it('loads both validated PDF attachments in configured order', async () => {
    const wiringContent = Buffer.from('%PDF-1.7\nwiring\n');
    const w9Content = Buffer.from('%PDF-1.7\nw9\n');
    const documents = [
      definition('fee-breakdown/wiring-instructions', 'AHA Commission Wiring Instructions.pdf', wiringContent),
      definition('fee-breakdown/w9-2026', 'AHA W9 2026.pdf', w9Content),
    ];

    mockedFindOne
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(storedDocument(documents[0], wiringContent)) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(storedDocument(documents[1], w9Content)) });

    const attachments = await loadFeeBreakdownAttachments(documents);

    expect(attachments).toEqual([
      { filename: 'AHA Commission Wiring Instructions.pdf', content: wiringContent },
      { filename: 'AHA W9 2026.pdf', content: w9Content },
    ]);
    expect(mockedFindOne).toHaveBeenNthCalledWith(1, {
      key: 'fee-breakdown/wiring-instructions',
      version: 'test-v1',
    });
  });

  it('throws a clear error when a required document is missing', async () => {
    const content = Buffer.from('%PDF-1.7\nwiring\n');
    const documents = [
      definition('fee-breakdown/wiring-instructions', 'AHA Commission Wiring Instructions.pdf', content),
    ];
    mockedFindOne.mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });

    await expect(loadFeeBreakdownAttachments(documents)).rejects.toThrow(
      'Fee breakdown attachment is missing: AHA Commission Wiring Instructions.pdf'
    );
  });

  it('rejects stored content when metadata or PDF signature is corrupt', () => {
    const content = Buffer.from('%PDF-1.7\nwiring\n');
    const expected = definition(
      'fee-breakdown/wiring-instructions',
      'AHA Commission Wiring Instructions.pdf',
      content
    );

    expect(() =>
      validateStoredPdfDocument(
        {
          ...storedDocument(expected, content),
          sha256: 'different',
        },
        expected
      )
    ).toThrow(FeeBreakdownDocumentError);

    expect(() =>
      validateStoredPdfDocument(
        {
          ...storedDocument(expected, Buffer.from('not a pdf')),
          byteLength: Buffer.byteLength('not a pdf'),
          sha256: sha256(Buffer.from('not a pdf')),
        },
        expected
      )
    ).toThrow('does not have a PDF signature');
  });

  it('validates BSON Binary-style stored content from MongoDB read-back', () => {
    const content = Buffer.from('%PDF-1.7\nwiring\n');
    const expected = definition(
      'fee-breakdown/wiring-instructions',
      'AHA Commission Wiring Instructions.pdf',
      content
    );

    expect(
      validateStoredPdfDocument(
        {
          ...storedDocument(expected, content),
          content: { buffer: content } as any,
        },
        expected
      )
    ).toEqual({
      filename: expected.filename,
      content,
    });
  });

  it('surfaces database failures without returning partial attachments', async () => {
    const content = Buffer.from('%PDF-1.7\nwiring\n');
    const documents = [
      definition('fee-breakdown/wiring-instructions', 'AHA Commission Wiring Instructions.pdf', content),
    ];
    mockedFindOne.mockReturnValueOnce({
      lean: jest.fn().mockRejectedValue(new Error('database unavailable')),
    });

    await expect(loadFeeBreakdownAttachments(documents)).rejects.toThrow(
      'Unable to load fee breakdown attachments: database unavailable'
    );
  });
});
