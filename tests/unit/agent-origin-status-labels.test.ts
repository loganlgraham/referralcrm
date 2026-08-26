import { describe, expect, it } from '@jest/globals';
import {
  AGENT_ORIGIN_LOST_REASON_VALUES,
  LOST_REASON_OPTIONS,
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
  it('returns the full list for non-agent referrals', () => {
    expect(getLostReasonOptions()).toBe(LOST_REASON_OPTIONS);
    expect(getLostReasonOptions({ isAgentOrigin: false })).toBe(LOST_REASON_OPTIONS);
  });

  it('drops the agent-choice reasons for agent referrals', () => {
    const values = getLostReasonOptions({ isAgentOrigin: true }).map((option) => option.value);

    expect(values).not.toContain('already_had_agent');
    expect(values).not.toContain('chose_other_agent_precontact');
    expect(values).not.toContain('chose_other_agent_postcontact');
    expect(values).toEqual([...AGENT_ORIGIN_LOST_REASON_VALUES]);
  });

  it('words the remaining reasons around the mortgage consultant', () => {
    const labelsByValue = new Map(
      getLostReasonOptions({ isAgentOrigin: true }).map((option) => [option.value, option.label])
    );

    expect(labelsByValue.get('never_connected')).toBe('MC was never able to reach the client');
    expect(labelsByValue.get('unresponsive_after_contact')).toBe(
      'Client went quiet after the MC connected'
    );
    // Reasons without an override fall back to the shared copy.
    expect(labelsByValue.get('no_longer_buying')).toBe('No longer buying / timeline changed');
  });

  it('returns a stable reference so it can be read during render', () => {
    expect(getLostReasonOptions({ isAgentOrigin: true })).toBe(
      getLostReasonOptions({ isAgentOrigin: true })
    );
  });
});
