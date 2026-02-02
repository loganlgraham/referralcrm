/**
 * AHA designation helpers for admin task rule selection.
 * Extracted to allow testing without mongoose dependency.
 */

export type AhaDesignation = 'AHA_OOS' | 'AHA' | 'default';

interface AgentLike {
  ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
}

/**
 * Determine which task rule set applies based on attached agents' ahaDesignation.
 * AHA_OOS takes precedence over AHA; AHA over default (no AHA designation).
 */
export function getAhaDesignation(referral: {
  assignedAgent?: AgentLike | null;
  buySideAgent?: AgentLike | null;
  sellSideAgent?: AgentLike | null;
}): AhaDesignation {
  const agents = [
    referral.assignedAgent,
    referral.buySideAgent,
    referral.sellSideAgent,
  ].filter(Boolean) as AgentLike[];
  const hasOos = agents.some((a) => a.ahaDesignation === 'AHA_OOS');
  const hasAha = agents.some((a) => a.ahaDesignation === 'AHA');
  if (hasOos) return 'AHA_OOS';
  if (hasAha) return 'AHA';
  return 'default';
}
