import { parseFubPersonId, parseParticipantKey, type IntelligenceOrg } from './panel';

export type LinkAudit = {
  actorId: string;
  at: string;
  action: 'link' | 'correct' | 'unlink';
  previousPersonId: number | null;
  nextPersonId: number | null;
};

export type CustomerLink = {
  id: string;
  organization: IntelligenceOrg;
  fubAccountId: string;
  referralId: string;
  participantKey: string;
  fubPersonId: number | null;
  audit: LinkAudit[];
};

export type AgentLink = {
  id: string;
  organization: IntelligenceOrg;
  fubAccountId: string;
  agentId: string;
  fubUserId: number;
  audit: LinkAudit[];
};

export type LinkRepository = {
  findCustomer(input: { organization: IntelligenceOrg; fubAccountId: string; referralId: string; participantKey: string }): CustomerLink | null;
  saveCustomer(link: CustomerLink): void;
  listCustomers(input: { organization: IntelligenceOrg; fubAccountId: string; referralId: string }): CustomerLink[];
  findAgent(input: { organization: IntelligenceOrg; fubAccountId: string; agentId: string }): AgentLink | null;
  saveAgent(link: AgentLink): void;
};

export function createMemoryLinks(): LinkRepository & { customers: CustomerLink[]; agents: AgentLink[] } {
  const customers: CustomerLink[] = [];
  const agents: AgentLink[] = [];
  return {
    customers,
    agents,
    findCustomer(input) {
      return customers.find((link) => sameCustomer(link, input)) ?? null;
    },
    saveCustomer(link) {
      const index = customers.findIndex((item) => item.id === link.id || sameCustomer(item, link));
      if (index >= 0) customers[index] = link;
      else customers.push(link);
    },
    listCustomers(input) {
      return customers.filter((link) => link.organization === input.organization && link.fubAccountId === input.fubAccountId && link.referralId === input.referralId);
    },
    findAgent(input) {
      return agents.find((link) => link.organization === input.organization && link.fubAccountId === input.fubAccountId && link.agentId === input.agentId) ?? null;
    },
    saveAgent(link) {
      const index = agents.findIndex((item) => item.id === link.id || (item.organization === link.organization && item.fubAccountId === link.fubAccountId && item.agentId === link.agentId));
      if (index >= 0) agents[index] = link;
      else agents.push(link);
    },
  };
}

export function setCustomerLink(
  repo: LinkRepository,
  input: {
    organization: IntelligenceOrg;
    fubAccountId: string;
    referralId: string;
    participantKey: unknown;
    personId: unknown;
    actorId: string;
    at: string;
  },
): { ok: true; link: CustomerLink } | { ok: false; reason: 'participant' | 'person' | 'actor' } {
  const participantKey = parseParticipantKey(input.participantKey);
  const personId = parseFubPersonId(input.personId);
  if (!participantKey) return { ok: false, reason: 'participant' };
  if (personId === 'invalid') return { ok: false, reason: 'person' };
  if (!input.actorId) return { ok: false, reason: 'actor' };
  const existing = repo.findCustomer({
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    referralId: input.referralId,
    participantKey,
  });
  const previous = existing?.fubPersonId ?? null;
  if (existing && previous === personId) return { ok: true, link: existing };
  const action = personId === null ? 'unlink' : previous === null ? 'link' : 'correct';
  const link: CustomerLink = {
    id: existing?.id ?? `${input.organization}:${input.referralId}:${participantKey}`,
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    referralId: input.referralId,
    participantKey,
    fubPersonId: personId,
    audit: [...(existing?.audit ?? []), { actorId: input.actorId, at: input.at, action, previousPersonId: previous, nextPersonId: personId }],
  };
  repo.saveCustomer(link);
  return { ok: true, link };
}

export function setAgentLink(
  repo: LinkRepository,
  input: {
    organization: IntelligenceOrg;
    fubAccountId: string;
    agentId: string;
    fubUserId: unknown;
    actorId: string;
    at: string;
  },
): { ok: true; link: AgentLink } | { ok: false; reason: 'user' | 'actor' | 'agent' } {
  const fubUserId = parseFubPersonId(input.fubUserId);
  if (!input.agentId) return { ok: false, reason: 'agent' };
  if (typeof fubUserId !== 'number') return { ok: false, reason: 'user' };
  if (!input.actorId) return { ok: false, reason: 'actor' };
  const existing = repo.findAgent(input);
  if (existing && existing.fubUserId === fubUserId) return { ok: true, link: existing };
  const link: AgentLink = {
    id: existing?.id ?? `${input.organization}:${input.agentId}`,
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    agentId: input.agentId,
    fubUserId,
    audit: [...(existing?.audit ?? []), {
      actorId: input.actorId,
      at: input.at,
      action: existing ? 'correct' : 'link',
      previousPersonId: existing?.fubUserId ?? null,
      nextPersonId: fubUserId,
    }],
  };
  repo.saveAgent(link);
  return { ok: true, link };
}

function sameCustomer(link: CustomerLink, input: { organization: IntelligenceOrg; fubAccountId: string; referralId: string; participantKey: string }): boolean {
  return link.organization === input.organization
    && link.fubAccountId === input.fubAccountId
    && link.referralId === input.referralId
    && link.participantKey === input.participantKey;
}
