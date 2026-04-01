import {
  dealStatusToDisplay,
  formatNotificationContent,
} from '@/lib/format-notification-content';

describe('dealStatusToDisplay', () => {
  it('maps known deal status slugs', () => {
    expect(dealStatusToDisplay('under_contract')).toBe('Under Contract');
    expect(dealStatusToDisplay('payment_sent')).toBe('Payment Sent');
    expect(dealStatusToDisplay('clear_to_close')).toBe('Clear to Close');
  });

  it('returns Unknown for empty values', () => {
    expect(dealStatusToDisplay(null)).toBe('Unknown');
    expect(dealStatusToDisplay(undefined)).toBe('Unknown');
    expect(dealStatusToDisplay('')).toBe('Unknown');
  });

  it('passes through unknown strings', () => {
    expect(dealStatusToDisplay('custom')).toBe('custom');
  });
});

describe('formatNotificationContent', () => {
  it('replaces deal status slugs in sentences', () => {
    expect(
      formatNotificationContent(
        'Alex changed deal status from under_contract to payment_sent for Jane'
      )
    ).toBe('Alex changed deal status from Under Contract to Payment Sent for Jane');
  });

  it('replaces referral timeline slugs', () => {
    expect(formatNotificationContent('Timeline set to 1-3_months')).toBe(
      'Timeline set to 1-3 months'
    );
  });

  it('is idempotent when labels are already human-readable', () => {
    const s = 'Status is Under Contract and Payment Sent';
    expect(formatNotificationContent(s)).toBe(s);
  });
});
