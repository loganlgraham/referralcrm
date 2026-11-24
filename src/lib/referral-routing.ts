type AgentSlot<T> = {
  clientType?: unknown;
  assignedAgent?: T | null;
  buySideAgent?: T | null;
  sellSideAgent?: T | null;
};

export type IntakeRoute = 'AHA' | 'AHA_OOS';

export type RoutingSource = AgentSlot<unknown> & {
  origin?: unknown;
  inboundEmail?: { messageId?: unknown; channel?: unknown; routeHint?: unknown } | null;
  ahaBucket?: unknown;
};

export function routingAgent<T>(referral: AgentSlot<T>): T | null {
  if (referral.clientType === 'Seller') return referral.sellSideAgent ?? referral.assignedAgent ?? null;
  if (referral.clientType === 'Both' && referral.sellSideAgent && !referral.buySideAgent) return null;
  return referral.buySideAgent ?? referral.assignedAgent ?? null;
}

export function mailboxRoute(referral: Pick<RoutingSource, 'inboundEmail' | 'ahaBucket'>): IntakeRoute | null {
  const email = referral.inboundEmail;
  if (!email) return null;
  if (email.channel === 'AHA' || email.channel === 'AHA_OOS') return email.channel;
  if (email.routeHint === 'aha') return 'AHA';
  if (email.routeHint === 'ahaoos') return 'AHA_OOS';
  const bucket = referral.ahaBucket;
  return email.messageId && (bucket === 'AHA' || bucket === 'AHA_OOS') ? bucket : null;
}

export function needsInitialAgentSuggestion(referral: RoutingSource): boolean {
  return !referral.inboundEmail && referral.origin !== 'agent' && !routingAgent(referral);
}

/** Outbound brokerage referrals follow their intake mailbox or their manually assigned agent. */
export function referralWorkflowRoute(referral: RoutingSource): IntakeRoute | null {
  if (referral.inboundEmail) return mailboxRoute(referral);
  if (referral.origin === 'agent') return null; // An agent introducing a client to the lender is the reverse workflow.
  const agent = routingAgent(referral);
  const designation = agent && typeof agent === 'object' && 'ahaDesignation' in agent ? agent.ahaDesignation : null;
  return designation === 'AHA' || designation === 'AHA_OOS' ? designation : null;
}
