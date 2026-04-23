/**
 * Shared designation resolvers used by the dashboard API, email reports, and
 * any other surface that must agree on how a referral/payment maps to
 * AHA / AHA_OOS / AGIT / null. Having a single module prevents the live
 * dashboard and the email report from drifting (C-13).
 */

export type NetworkDesignation = 'AHA' | 'AHA_OOS' | 'AGIT';

export type ReferralAgentSlots = {
  assignedAgent?: { toString(): string } | null | undefined;
  buySideAgent?: { toString(): string } | null | undefined;
  sellSideAgent?: { toString(): string } | null | undefined;
};

export type PaymentAgentSlots = {
  agentId?: { toString(): string } | null | undefined;
  referral?: {
    assignedAgent?: { toString(): string } | null | undefined;
  } | null;
};

/**
 * Resolve a referral's network designation by walking
 * assignedAgent → buySideAgent → sellSideAgent and picking the first agent
 * that has a designation in the provided map.
 */
export function getReferralDesignation(
  referral: ReferralAgentSlots,
  designationMap: Map<string, NetworkDesignation | null>
): NetworkDesignation | null {
  const slots = [referral.assignedAgent, referral.buySideAgent, referral.sellSideAgent];
  for (const id of slots) {
    if (!id) continue;
    const designation = designationMap.get(id.toString());
    if (designation) return designation;
  }
  return null;
}

/**
 * Resolve a payment's network designation by preferring the payment-level
 * agentId and falling back to the referral's assignedAgent.
 */
export function getPaymentAgentDesignation(
  payment: PaymentAgentSlots,
  designationMap: Map<string, NetworkDesignation | null>
): NetworkDesignation | null {
  const agentId = payment.agentId ?? payment.referral?.assignedAgent;
  if (!agentId) return null;
  return designationMap.get(agentId.toString()) ?? null;
}
