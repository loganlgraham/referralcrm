import { shouldDefaultEmailMcForAgentNotes } from '@/utils/referral-email-defaults';

describe('shouldDefaultEmailMcForAgentNotes', () => {
  it('defaults off for admin even when MC email exists and there are no payments', () => {
    expect(
      shouldDefaultEmailMcForAgentNotes({
        viewerRole: 'admin',
        hasMcEmail: true,
        hasAnyPayments: false,
        hasAnyUsedAfcTrue: false,
      })
    ).toBe(false);
  });

  it('defaults off for manager and mc roles', () => {
    expect(
      shouldDefaultEmailMcForAgentNotes({
        viewerRole: 'manager',
        hasMcEmail: true,
        hasAnyPayments: false,
        hasAnyUsedAfcTrue: false,
      })
    ).toBe(false);
    expect(
      shouldDefaultEmailMcForAgentNotes({
        viewerRole: 'mc',
        hasMcEmail: true,
        hasAnyPayments: false,
        hasAnyUsedAfcTrue: false,
      })
    ).toBe(false);
  });

  it('defaults on for agent with MC email and no buy-side payments', () => {
    expect(
      shouldDefaultEmailMcForAgentNotes({
        viewerRole: 'agent',
        hasMcEmail: true,
        hasAnyPayments: false,
        hasAnyUsedAfcTrue: false,
      })
    ).toBe(true);
  });

  it('defaults on for agent when a buy-side deal used AFC', () => {
    expect(
      shouldDefaultEmailMcForAgentNotes({
        viewerRole: 'agent',
        hasMcEmail: true,
        hasAnyPayments: true,
        hasAnyUsedAfcTrue: true,
      })
    ).toBe(true);
  });

  it('defaults off for agent when buy-side deals exist and none used AFC', () => {
    expect(
      shouldDefaultEmailMcForAgentNotes({
        viewerRole: 'agent',
        hasMcEmail: true,
        hasAnyPayments: true,
        hasAnyUsedAfcTrue: false,
      })
    ).toBe(false);
  });

  it('defaults off when there is no MC email', () => {
    expect(
      shouldDefaultEmailMcForAgentNotes({
        viewerRole: 'agent',
        hasMcEmail: false,
        hasAnyPayments: false,
        hasAnyUsedAfcTrue: false,
      })
    ).toBe(false);
  });
});
