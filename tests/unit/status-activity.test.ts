import { parseStatusActivityLabel } from '@/utils/status-activity';

describe('parseStatusActivityLabel', () => {
  it('reads the landing status from the stored activity line', () => {
    expect(parseStatusActivityLabel('Status changed from Active Lead to Under Contract')).toBe(
      'Under Contract'
    );
  });

  it('still reads the shorter wording', () => {
    expect(parseStatusActivityLabel('Status changed to Paired')).toBe('Paired');
  });

  it('ignores deal-stage lines and notes', () => {
    expect(parseStatusActivityLabel('Deal status changed from Under Contract to Closed')).toBeNull();
    expect(parseStatusActivityLabel('Called the client')).toBeNull();
  });
});
