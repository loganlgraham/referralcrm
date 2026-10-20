import { afterEach, describe, expect, it } from '@jest/globals';
import {
  buildCcList,
  canPromoteNoteCopy,
  getReferralNotificationRecipients,
  parseCcRecipients,
  partitionNoteCopy,
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

describe('partitionNoteCopy', () => {
  it('keeps extras on CC and drops anyone already in To', () => {
    expect(
      partitionNoteCopy({
        toEmails: ['Agent@Example.com'],
        ccInput: ['agent@example.com', 'one@example.com', 'two@example.com', 'nope'],
        promoteWhenNoRecipients: false,
      })
    ).toEqual({
      cc: ['one@example.com', 'two@example.com'],
      promotedTo: [],
    });
  });

  it('promotes extras to To when there is nobody to email yet', () => {
    expect(
      partitionNoteCopy({
        toEmails: [],
        ccInput: ['Admin@Example.com', 'other@example.com'],
        promoteWhenNoRecipients: true,
      })
    ).toEqual({
      cc: [],
      promotedTo: ['admin@example.com', 'other@example.com'],
    });
  });

  it('leaves extras on CC when someone is already in To', () => {
    expect(
      partitionNoteCopy({
        toEmails: ['mc@example.com'],
        ccInput: ['admin@example.com'],
        promoteWhenNoRecipients: true,
      })
    ).toEqual({
      cc: ['admin@example.com'],
      promotedTo: [],
    });
  });
});

describe('canPromoteNoteCopy', () => {
  it('lets an admin with no recipients promote a lone admin target', () => {
    expect(canPromoteNoteCopy('admin', true, 0)).toBe(true);
  });

  it('does not promote CC into To for agents, MCs, or when someone is already addressed', () => {
    expect(canPromoteNoteCopy('agent', true, 0)).toBe(false);
    expect(canPromoteNoteCopy('mc', true, 0)).toBe(false);
    expect(canPromoteNoteCopy('admin', false, 0)).toBe(false);
    expect(canPromoteNoteCopy('admin', true, 1)).toBe(false);
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
