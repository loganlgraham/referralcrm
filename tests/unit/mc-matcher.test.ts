import { LenderMC } from '@/models/lender';
import { findMcByFirstNameLastInitialToken, normalizeMcToken } from '@/lib/server/mc-matcher';

jest.mock('@/models/lender', () => ({
  LenderMC: {
    find: jest.fn()
  }
}));

const mockedLenderFind = LenderMC.find as jest.Mock;

type FakeLender = { _id: unknown; name: string };

function mockLenderFindReturn(lenders: FakeLender[]) {
  mockedLenderFind.mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(lenders)
    })
  });
}

function objectIdLike(value: string): { toString: () => string } {
  return { toString: () => value };
}

describe('normalizeMcToken', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(normalizeMcToken('KarimL')).toBe('kariml');
    expect(normalizeMcToken('Karim L')).toBe('kariml');
    expect(normalizeMcToken('Karim.L')).toBe('kariml');
    expect(normalizeMcToken('  Karim_L  ')).toBe('kariml');
  });

  it('returns an empty string for blank or purely symbolic input', () => {
    expect(normalizeMcToken('')).toBe('');
    expect(normalizeMcToken('   ')).toBe('');
    expect(normalizeMcToken('...')).toBe('');
  });
});

describe('findMcByFirstNameLastInitialToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a single match when the token matches firstName + last initial exactly', async () => {
    const lenderId = objectIdLike('lender-karim');
    mockLenderFindReturn([
      { _id: lenderId, name: 'Karim Lopez' },
      { _id: objectIdLike('lender-jane'), name: 'Jane Doe' }
    ]);

    const result = await findMcByFirstNameLastInitialToken('KarimL');

    expect(result).toEqual({ id: lenderId, name: 'Karim Lopez' });
  });

  it('matches case-insensitively', async () => {
    const lenderId = objectIdLike('lender-karim');
    mockLenderFindReturn([{ _id: lenderId, name: 'Karim Lopez' }]);

    const result = await findMcByFirstNameLastInitialToken('kariml');

    expect(result).toEqual({ id: lenderId, name: 'Karim Lopez' });
  });

  it('skips lenders with no last-name token', async () => {
    mockLenderFindReturn([{ _id: objectIdLike('lender-karim'), name: 'Karim' }]);

    const result = await findMcByFirstNameLastInitialToken('KarimL');

    expect(result).toBeNull();
  });

  it('returns an ambiguous sentinel when multiple lenders share the same token', async () => {
    const first = objectIdLike('lender-1');
    const second = objectIdLike('lender-2');
    mockLenderFindReturn([
      { _id: first, name: 'Karim Lopez' },
      { _id: second, name: 'Karim Lang' }
    ]);

    const result = await findMcByFirstNameLastInitialToken('KarimL');

    expect(result).toEqual({
      ambiguous: true,
      candidateIds: ['lender-1', 'lender-2']
    });
  });

  it('returns null when there are no lenders at all', async () => {
    mockLenderFindReturn([]);

    const result = await findMcByFirstNameLastInitialToken('KarimL');

    expect(result).toBeNull();
  });

  it('returns null for an empty normalized token', async () => {
    const result = await findMcByFirstNameLastInitialToken('...');

    expect(result).toBeNull();
    expect(mockedLenderFind).not.toHaveBeenCalled();
  });

  it('uses the last whitespace-separated token for the last initial when the name has a middle part', async () => {
    const lenderId = objectIdLike('lender-karim');
    mockLenderFindReturn([{ _id: lenderId, name: 'Karim Al Lopez' }]);

    const result = await findMcByFirstNameLastInitialToken('KarimL');

    expect(result).toEqual({ id: lenderId, name: 'Karim Al Lopez' });
  });
});
