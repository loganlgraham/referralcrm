import { describe, expect, it } from '@jest/globals';
import {
  LOST_REASON_LABELS,
  LOST_REASON_OPTIONS,
  LOST_REASON_VALUES,
  REFERRAL_STATUSES,
  getLostReasonOptions,
  getReferralStatusLabel,
} from '@/constants/referrals';

describe('getReferralStatusLabel', () => {
  it('returns the stored status for both agent and non-agent referrals', () => {
    for (const status of REFERRAL_STATUSES) {
      expect(getReferralStatusLabel(status)).toBe(status);
      expect(getReferralStatusLabel(status, { isAgentOrigin: false })).toBe(status);
      expect(getReferralStatusLabel(status, { isAgentOrigin: true })).toBe(status);
    }
  });

  it('normalizes the legacy Showing Homes alias to Active Lead', () => {
    expect(getReferralStatusLabel('Showing Homes')).toBe('Active Lead');
    expect(getReferralStatusLabel('Showing Homes', { isAgentOrigin: true })).toBe('Active Lead');
  });

  it('passes through deal-stage labels that are not referral statuses', () => {
    expect(getReferralStatusLabel('Clear to Close', { isAgentOrigin: true })).toBe('Clear to Close');
    expect(getReferralStatusLabel('Payment Received', { isAgentOrigin: true })).toBe('Payment Received');
  });
});

describe('getLostReasonOptions', () => {
  it('returns the same full list for every origin', () => {
    expect(getLostReasonOptions()).toBe(LOST_REASON_OPTIONS);
    expect(getLostReasonOptions({ isAgentOrigin: false })).toBe(LOST_REASON_OPTIONS);
    expect(getLostReasonOptions({ isAgentOrigin: true })).toBe(LOST_REASON_OPTIONS);
    expect(getLostReasonOptions({ isAgentOrigin: true }).map((option) => option.value)).toEqual([
      ...LOST_REASON_VALUES
    ]);
  });

  it('keeps borrower-focused wording and never names the MC or agent', () => {
    expect(LOST_REASON_LABELS.never_connected).toBe('Never able to reach the borrower');
    expect(LOST_REASON_LABELS.already_had_agent).toBe('Already working with someone else');
    expect(LOST_REASON_LABELS.chose_other_agent_precontact).toBe(
      'Went with someone else before we connected'
    );
    expect(LOST_REASON_LABELS.chose_other_agent_postcontact).toBe(
      'Went with someone else after we connected'
    );
    expect(LOST_REASON_LABELS.out_of_area).toBe('Looking outside our area');
    expect(LOST_REASON_LABELS.already_transacted).toBe('Already bought or sold');
    expect(LOST_REASON_LABELS.duplicate_or_invalid).toBe('Duplicate or bad contact info');

    for (const label of Object.values(LOST_REASON_LABELS)) {
      expect(label).not.toMatch(/\bMC\b/i);
      expect(label).not.toMatch(/\bagent\b/i);
    }
  });

  it('returns a stable reference so it can be read during render', () => {
    expect(getLostReasonOptions({ isAgentOrigin: true })).toBe(
      getLostReasonOptions({ isAgentOrigin: true })
    );
  });
});
