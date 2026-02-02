import { getAhaDesignation } from '@/lib/server/admin-task-designation';

describe('getAhaDesignation (admin task rule selection)', () => {
  it('returns AHA_OOS when any attached agent has AHA_OOS designation', () => {
    expect(
      getAhaDesignation({
        assignedAgent: { ahaDesignation: 'AHA_OOS' },
        buySideAgent: null,
        sellSideAgent: null,
      })
    ).toBe('AHA_OOS');
    expect(
      getAhaDesignation({
        assignedAgent: null,
        buySideAgent: { ahaDesignation: 'AHA_OOS' },
        sellSideAgent: null,
      })
    ).toBe('AHA_OOS');
    expect(
      getAhaDesignation({
        assignedAgent: null,
        buySideAgent: null,
        sellSideAgent: { ahaDesignation: 'AHA_OOS' },
      })
    ).toBe('AHA_OOS');
  });

  it('returns AHA_OOS when both AHA and AHA_OOS agents attached (OOS takes precedence)', () => {
    expect(
      getAhaDesignation({
        assignedAgent: { ahaDesignation: 'AHA' },
        buySideAgent: { ahaDesignation: 'AHA_OOS' },
        sellSideAgent: null,
      })
    ).toBe('AHA_OOS');
  });

  it('returns AHA when any attached agent has AHA designation and none have AHA_OOS', () => {
    expect(
      getAhaDesignation({
        assignedAgent: { ahaDesignation: 'AHA' },
        buySideAgent: null,
        sellSideAgent: null,
      })
    ).toBe('AHA');
    expect(
      getAhaDesignation({
        assignedAgent: null,
        buySideAgent: { ahaDesignation: 'AHA' },
        sellSideAgent: null,
      })
    ).toBe('AHA');
  });

  it('returns default when no agents are attached', () => {
    expect(
      getAhaDesignation({
        assignedAgent: null,
        buySideAgent: null,
        sellSideAgent: null,
      })
    ).toBe('default');
  });

  it('returns default when agents have other designations (AGIT or null)', () => {
    expect(
      getAhaDesignation({
        assignedAgent: { ahaDesignation: 'AGIT' },
        buySideAgent: null,
        sellSideAgent: null,
      })
    ).toBe('default');
    expect(
      getAhaDesignation({
        assignedAgent: { ahaDesignation: null },
        buySideAgent: null,
        sellSideAgent: null,
      })
    ).toBe('default');
  });
});
