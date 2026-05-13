import { LenderMC } from '@/models/lender';
import {
  findMcByFirstNameLastInitialToken,
  findMcInFreeText,
  normalizeMcToken
} from '@/lib/server/mc-matcher';

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

  it('supports alias token ChristopherL for Chris last-initial matching', async () => {
    const lenderId = objectIdLike('lender-chris');
    mockLenderFindReturn([{ _id: lenderId, name: 'Chris Leo' }]);

    const result = await findMcByFirstNameLastInitialToken('ChristopherL');

    expect(result).toEqual({ id: lenderId, name: 'Chris Leo' });
  });

  it('supports alias token JasonCr for Jason last-initial matching', async () => {
    const lenderId = objectIdLike('lender-jason');
    mockLenderFindReturn([{ _id: lenderId, name: 'Jason Creech' }]);

    const result = await findMcByFirstNameLastInitialToken('JasonCr');

    expect(result).toEqual({ id: lenderId, name: 'Jason Creech' });
  });

  it('supports alias token NebiyuA for Neb last-initial matching', async () => {
    const lenderId = objectIdLike('lender-neb');
    mockLenderFindReturn([{ _id: lenderId, name: 'Neb Ayalew' }]);

    const result = await findMcByFirstNameLastInitialToken('NebiyuA');

    expect(result).toEqual({ id: lenderId, name: 'Neb Ayalew' });
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

describe('findMcInFreeText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a unique match when an MC token appears next to the loan number', async () => {
    const lenderId = objectIdLike('lender-karim');
    mockLenderFindReturn([
      { _id: lenderId, name: 'Karim Lopez' },
      { _id: objectIdLike('lender-jane'), name: 'Jane Doe' }
    ]);

    const body = [
      'First: Alice',
      'Last: Buyer',
      'Loan Number: 12345 KarimL',
      'Stage on transfer: Pre-approved'
    ].join('\n');

    const result = await findMcInFreeText(body);

    expect(result).toEqual({ id: lenderId, name: 'Karim Lopez' });
  });

  it('returns null when no candidate tokens appear in the text', async () => {
    mockLenderFindReturn([{ _id: objectIdLike('lender-karim'), name: 'Karim Lopez' }]);

    const result = await findMcInFreeText('Loan Number: 12345\nStage: pre-approved');

    expect(result).toBeNull();
  });

  it('returns null when candidate tokens exist but none match a real MC', async () => {
    mockLenderFindReturn([{ _id: objectIdLike('lender-karim'), name: 'Karim Lopez' }]);

    const result = await findMcInFreeText('Contact person: RobertS placed the call');

    expect(result).toBeNull();
  });

  it('returns an ambiguous sentinel when two different MC tokens both match real MCs', async () => {
    const first = objectIdLike('lender-karim');
    const second = objectIdLike('lender-jane');
    mockLenderFindReturn([
      { _id: first, name: 'Karim Lopez' },
      { _id: second, name: 'Jane Doe' }
    ]);

    const body = 'Originally from KarimL but later re-routed by JaneD on Tuesday.';

    const result = await findMcInFreeText(body);

    expect(result && 'ambiguous' in result ? result.ambiguous : false).toBe(true);
    expect(result && 'candidateIds' in result ? result.candidateIds.sort() : []).toEqual(
      ['lender-jane', 'lender-karim']
    );
  });

  it('returns a single match when the same MC token appears multiple times', async () => {
    const lenderId = objectIdLike('lender-karim');
    mockLenderFindReturn([{ _id: lenderId, name: 'Karim Lopez' }]);

    const body = 'Source: KarimL\nNotes: follow up with KarimL tomorrow.\nLoan number: 99 KarimL';

    const result = await findMcInFreeText(body);

    expect(result).toEqual({ id: lenderId, name: 'Karim Lopez' });
  });

  it('supports alias tokens found in free text', async () => {
    const chrisId = objectIdLike('lender-chris');
    const jasonId = objectIdLike('lender-jason');
    mockLenderFindReturn([
      { _id: chrisId, name: 'Chris Leo' },
      { _id: jasonId, name: 'Jason Creech' }
    ]);

    const chrisResult = await findMcInFreeText('Source: ChristopherL');
    const jasonResult = await findMcInFreeText('Source: JasonCr');

    expect(chrisResult).toEqual({ id: chrisId, name: 'Chris Leo' });
    expect(jasonResult).toEqual({ id: jasonId, name: 'Jason Creech' });
  });

  it('ignores strings like McDonald, NYC, and USA that do not fit FirstNameLastInitial', async () => {
    mockLenderFindReturn([{ _id: objectIdLike('lender-karim'), name: 'Karim Lopez' }]);

    const body = 'Borrower: McDonald family from NYC, moving from USA next month.';

    const result = await findMcInFreeText(body);

    expect(result).toBeNull();
  });

  it('returns null for an empty input without querying lenders', async () => {
    const result = await findMcInFreeText('');

    expect(result).toBeNull();
    expect(mockedLenderFind).not.toHaveBeenCalled();
  });
});
