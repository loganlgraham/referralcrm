import { parseSignatureHeader } from '@/app/api/inbound-email/signature';

describe('parseSignatureHeader', () => {
  it('preserves signature padding when parsing comma-separated entries', () => {
    const header = 't=1700000000,v1=abc123+/=';

    expect(parseSignatureHeader(header)).toEqual({
      signature: 'abc123+/=',
      timestamp: '1700000000'
    });
  });

  it('returns null when signature is missing', () => {
    const header = 't=1700000000';

    expect(parseSignatureHeader(header)).toBeNull();
  });
});
