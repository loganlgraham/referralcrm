/**
 * Auto-Update Reminders Helper Functions
 *
 * Utilities for determining when automated update reminders should be enabled by default.
 */

/**
 * Agent-like object with optional ahaDesignation field
 */
interface AgentLike {
  ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
}

/**
 * Referral-like object with optional agent references
 */
interface ReferralLike {
  assignedAgent?: AgentLike | null;
  buySideAgent?: AgentLike | null;
  sellSideAgent?: AgentLike | null;
}

/**
 * Check if a referral has an attached agent with AHA_OOS designation.
 * Checks assignedAgent, buySideAgent, and sellSideAgent.
 *
 * @param referral - Referral object (or similar) with populated agent fields
 * @returns true if any attached agent has ahaDesignation === 'AHA_OOS'
 */
export function hasAhaOosAgentAttached(referral: ReferralLike): boolean {
  return (
    referral.assignedAgent?.ahaDesignation === 'AHA_OOS' ||
    referral.buySideAgent?.ahaDesignation === 'AHA_OOS' ||
    referral.sellSideAgent?.ahaDesignation === 'AHA_OOS'
  );
}
