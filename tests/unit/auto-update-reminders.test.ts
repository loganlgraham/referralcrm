import { hasAhaOosAgentAttached } from '@/lib/server/auto-update-reminders';

describe('hasAhaOosAgentAttached', () => {
  it('returns true when assignedAgent has AHA_OOS designation', () => {
    const referral = {
      assignedAgent: { ahaDesignation: 'AHA_OOS' },
      buySideAgent: null,
      sellSideAgent: null,
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(true);
  });

  it('returns true when buySideAgent has AHA_OOS designation', () => {
    const referral = {
      assignedAgent: null,
      buySideAgent: { ahaDesignation: 'AHA_OOS' },
      sellSideAgent: null,
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(true);
  });

  it('returns true when sellSideAgent has AHA_OOS designation', () => {
    const referral = {
      assignedAgent: null,
      buySideAgent: null,
      sellSideAgent: { ahaDesignation: 'AHA_OOS' },
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(true);
  });

  it('returns true when multiple agents have AHA_OOS designation', () => {
    const referral = {
      assignedAgent: { ahaDesignation: 'AHA_OOS' },
      buySideAgent: { ahaDesignation: 'AHA_OOS' },
      sellSideAgent: null,
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(true);
  });

  it('returns false when no agents are attached', () => {
    const referral = {
      assignedAgent: null,
      buySideAgent: null,
      sellSideAgent: null,
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(false);
  });

  it('returns false when agents have other designations', () => {
    const referral = {
      assignedAgent: { ahaDesignation: 'AHA' },
      buySideAgent: { ahaDesignation: 'AGIT' },
      sellSideAgent: { ahaDesignation: null },
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(false);
  });

  it('returns false when agents have null designation', () => {
    const referral = {
      assignedAgent: { ahaDesignation: null },
      buySideAgent: { ahaDesignation: null },
      sellSideAgent: { ahaDesignation: null },
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(false);
  });

  it('returns false when agents are missing ahaDesignation field', () => {
    const referral = {
      assignedAgent: {},
      buySideAgent: {},
      sellSideAgent: {},
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(false);
  });

  it('returns false when all agent fields are undefined', () => {
    const referral = {};
    expect(hasAhaOosAgentAttached(referral)).toBe(false);
  });

  it('handles mixed designations correctly', () => {
    const referral = {
      assignedAgent: { ahaDesignation: 'AHA' },
      buySideAgent: { ahaDesignation: 'AHA_OOS' },
      sellSideAgent: { ahaDesignation: 'AGIT' },
    };
    expect(hasAhaOosAgentAttached(referral)).toBe(true);
  });
});
