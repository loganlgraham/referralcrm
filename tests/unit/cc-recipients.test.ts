import { afterEach, describe, expect, it } from '@jest/globals';
import {
  buildCcList,
  getReferralNotificationRecipients,
  parseCcRecipients,
} from '@/lib/server/cc-recipients';

describe('parseCcRecipients', () => {
  it('returns empty lists for missing or unsupported input', () => {
    expect(parseCcRecipients(undefined)).toEqual({ emails: [], invalid: [] });
    expect(parseCcRecipients(null)).toEqual({ emails: [], invalid: [] });
    expect(parseCcRecipients(42)).toEqual({ emails: [], invalid: [] });
    expect(parseCcRecipients([])).toEqual({ emails: [], invalid: [] });
  });

  it('accepts an array of addresses', () => {
    expect(parseCcRecipients(['one@example.com', 'two@example.com'])).toEqual({
      emails: ['one@example.com', 'two@example.com'],
      invalid: [],
    });
  });

  it('splits comma and semicolon separated strings', () => {
    expect(parseCcRecipients('one@example.com, two@example.com; three@example.com')).toEqual({
      emails: ['one@example.com', 'two@example.com', 'three@example.com'],
      invalid: [],
    });
  });

  it('splits separated values inside array entries', () => {
    expect(parseCcRecipients(['one@example.com, two@example.com'])).toEqual({
      emails: ['one@example.com', 'two@example.com'],
      invalid: [],
    });
  });

  it('trims, lowercases, and dedupes addresses', () => {
    expect(parseCcRecipients(['  One@Example.com ', 'ONE@example.com'])).toEqual({
      emails: ['one@example.com'],
      invalid: [],
    });
  });

  it('drops blank entries', () => {
    expect(parseCcRecipients(['', '   ', 'one@example.com', ','])).toEqual({
      emails: ['one@example.com'],
      invalid: [],
    });
  });

  it('reports invalid addresses separately', () => {
    expect(parseCcRecipients(['good@example.com', 'nope', 'missing@domain'])).toEqual({
      emails: ['good@example.com'],
      invalid: ['nope', 'missing@domain'],
    });
  });
});

describe('buildCcList', () => {
  it('merges defaults with extras', () => {
    expect(buildCcList(['default@example.com'], ['extra@example.com'])).toEqual([
      'default@example.com',
      'extra@example.com',
    ]);
  });

  it('dedupes case-insensitively and normalizes', () => {
    expect(buildCcList(['Default@Example.com'], [' default@example.com ', 'extra@example.com'])).toEqual([
      'default@example.com',
      'extra@example.com',
    ]);
  });

  it('excludes the message recipient', () => {
    expect(
      buildCcList(['default@example.com'], ['agent@example.com'], 'Agent@Example.com')
    ).toEqual(['default@example.com']);
  });

  it('drops blank entries', () => {
    expect(buildCcList(['default@example.com', ''], ['  '])).toEqual(['default@example.com']);
  });
});

describe('getReferralNotificationRecipients', () => {
  const originalValue = process.env.REFERRAL_NOTIFICATION_RECIPIENTS;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.REFERRAL_NOTIFICATION_RECIPIENTS;
    } else {
      process.env.REFERRAL_NOTIFICATION_RECIPIENTS = originalValue;
    }
  });

  it('returns no recipients when unset rather than falling back to a hardcoded address', () => {
    delete process.env.REFERRAL_NOTIFICATION_RECIPIENTS;
    expect(getReferralNotificationRecipients()).toEqual([]);
  });

  it('returns no recipients when the value has no usable address', () => {
    process.env.REFERRAL_NOTIFICATION_RECIPIENTS = ' , ; ';
    expect(getReferralNotificationRecipients()).toEqual([]);
  });

  it('drops invalid entries but keeps the valid ones', () => {
    process.env.REFERRAL_NOTIFICATION_RECIPIENTS = 'nope, good@example.com';
    expect(getReferralNotificationRecipients()).toEqual(['good@example.com']);
  });

  it('reads a comma separated override', () => {
    process.env.REFERRAL_NOTIFICATION_RECIPIENTS = 'One@Example.com, two@example.com';
    expect(getReferralNotificationRecipients()).toEqual([
      'one@example.com',
      'two@example.com',
    ]);
  });
});
