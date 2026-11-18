import { Types } from 'mongoose';
import { IntelligenceAccess, IntelligenceAgentLink, IntelligenceLink } from '@/models/intelligence-link';
import { setAgentLink, setCustomerLink, type AgentLink, type CustomerLink, type LinkRepository } from '@/lib/intelligence/links';
import type { IntelligenceOrg } from '@/lib/intelligence/panel';

export async function readCustomerLink(input: {
  organization: IntelligenceOrg;
  fubAccountId: string;
  referralId: string;
  participantKey: string;
}): Promise<CustomerLink | null> {
  const doc = await IntelligenceLink.findOne({
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    referralId: new Types.ObjectId(input.referralId),
    participantKey: input.participantKey,
  }).lean<{ _id: Types.ObjectId; fubPersonId: number | null; audit?: CustomerLink['audit'] } | null>();
  if (!doc) return null;
  return {
    id: String(doc._id),
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    referralId: input.referralId,
    participantKey: input.participantKey,
    fubPersonId: doc.fubPersonId,
    audit: (doc.audit ?? []).map((entry) => ({ ...entry, actorId: String(entry.actorId), at: new Date(entry.at).toISOString() })),
  };
}

export async function writeCustomerLink(input: {
  organization: IntelligenceOrg;
  fubAccountId: string;
  referralId: string;
  participantKey: unknown;
  personId: unknown;
  actorId: string;
  at: string;
}): Promise<{ ok: true; link: CustomerLink } | { ok: false; reason: 'participant' | 'person' | 'actor' }> {
  const existing = typeof input.participantKey === 'string'
    ? await readCustomerLink({
      organization: input.organization,
      fubAccountId: input.fubAccountId,
      referralId: input.referralId,
      participantKey: input.participantKey,
    })
    : null;
  const memory = memoryFrom(existing);
  const result = setCustomerLink(memory, input);
  if (!result.ok) return result;
  await IntelligenceLink.findOneAndUpdate(
    {
      organization: input.organization,
      fubAccountId: input.fubAccountId,
      referralId: new Types.ObjectId(input.referralId),
      participantKey: result.link.participantKey,
    },
    {
      $set: { fubPersonId: result.link.fubPersonId, audit: result.link.audit.map((entry) => ({ ...entry, at: new Date(entry.at), actorId: new Types.ObjectId(entry.actorId) })) },
    },
    { upsert: true, new: true },
  );
  return result;
}

export async function readAgentLink(input: {
  organization: IntelligenceOrg;
  fubAccountId: string;
  agentId: string;
}): Promise<AgentLink | null> {
  if (!Types.ObjectId.isValid(input.agentId)) return null;
  const doc = await IntelligenceAgentLink.findOne({
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    agentId: new Types.ObjectId(input.agentId),
  }).lean<{ _id: Types.ObjectId; fubUserId: number; audit?: AgentLink['audit'] } | null>();
  if (!doc) return null;
  return {
    id: String(doc._id),
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    agentId: input.agentId,
    fubUserId: doc.fubUserId,
    audit: doc.audit ?? [],
  };
}

export async function writeAgentLink(input: {
  organization: IntelligenceOrg;
  fubAccountId: string;
  agentId: string;
  fubUserId: unknown;
  actorId: string;
  at: string;
}): Promise<{ ok: true; link: AgentLink } | { ok: false; reason: 'user' | 'actor' | 'agent' }> {
  const existing = await readAgentLink(input);
  let current = existing;
  const result = setAgentLink({
    findCustomer: () => null,
    saveCustomer: () => undefined,
    listCustomers: () => [],
    findAgent: () => current,
    saveAgent: (link) => {
      current = link;
    },
  }, input);
  if (!result.ok) return result;
  await IntelligenceAgentLink.findOneAndUpdate(
    {
      organization: input.organization,
      fubAccountId: input.fubAccountId,
      agentId: new Types.ObjectId(input.agentId),
    },
    {
      $set: {
        fubUserId: result.link.fubUserId,
        audit: result.link.audit.map((entry) => ({ ...entry, at: new Date(entry.at), actorId: new Types.ObjectId(entry.actorId) })),
      },
    },
    { upsert: true, new: true },
  );
  return result;
}

export async function readAccessGrant(input: {
  organization: IntelligenceOrg;
  fubAccountId: string;
  userId: string;
}): Promise<{ organization: IntelligenceOrg; fubAccountId: string; userId: string; revokedAt: string | null } | null> {
  if (!Types.ObjectId.isValid(input.userId)) return null;
  const doc = await IntelligenceAccess.findOne({
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    userId: new Types.ObjectId(input.userId),
  }).lean<{ userId: Types.ObjectId; revokedAt?: Date | null } | null>();
  if (!doc) return null;
  return {
    organization: input.organization,
    fubAccountId: input.fubAccountId,
    userId: input.userId,
    revokedAt: doc.revokedAt ? new Date(doc.revokedAt).toISOString() : null,
  };
}

function memoryFrom(existing: CustomerLink | null): LinkRepository {
  let current = existing;
  return {
    findCustomer() {
      return current;
    },
    saveCustomer(link) {
      current = link;
    },
    listCustomers() {
      return current ? [current] : [];
    },
    findAgent() {
      return null;
    },
    saveAgent() {
      return undefined;
    },
  };
}
