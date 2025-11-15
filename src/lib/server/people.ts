import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import type { DealStatus } from '@/constants/deals';
import {
  computeAgentMetrics,
  EMPTY_AGENT_METRICS,
  type AgentMetricsSummary
} from '@/lib/server/agent-metrics';

type NoteSummary = {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  emailedTargets: ('agent' | 'mc' | 'admin')[];
};

type AgentProfile = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  licenseNumber?: string;
  brokerage?: string;
  statesLicensed?: string[];
  coverageAreas?: string[];
  coverageLocations?: { label: string; zipCodes: string[] }[];
  specialties?: string[];
  languages?: string[];
  ahaDesignation?: 'AHA' | 'AHA_OOS' | null;
  metrics: AgentMetricsSummary;
  notes: NoteSummary[];
  deals: PersonDealSnapshot[];
};

type LenderProfile = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  nmlsId?: string;
  team?: string | null;
  region?: string | null;
  licensedStates?: string[];
  notes: NoteSummary[];
  deals: PersonDealSnapshot[];
};

export type PersonDealSnapshot = {
  id: string;
  referralId: string;
  borrowerName: string | null;
  loanFileNumber: string | null;
  propertyAddress: string | null;
  status: DealStatus | string | null;
  expectedAmountCents: number;
  receivedAmountCents: number;
  usedAfc: boolean | null;
  usedAssignedAgent: boolean | null;
  updatedAt: string | null;
  agent?: {
    id: string;
    name: string | null;
  } | null;
};

interface NoteRecord {
  _id: any;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: Date;
  emailedTargets?: ('agent' | 'mc' | 'admin')[];
}

const serializeNotes = (notes?: NoteRecord[] | null): NoteSummary[] =>
  (Array.isArray(notes) ? notes : []).map((note) => ({
    id: note._id.toString(),
    authorName: note.authorName,
    authorRole: note.authorRole,
    content: note.content,
    createdAt: note.createdAt instanceof Date ? note.createdAt.toISOString() : new Date(note.createdAt).toISOString(),
    emailedTargets: Array.isArray(note.emailedTargets) ? note.emailedTargets : []
  }));

type AgentLean = {
  _id: Types.ObjectId;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  licenseNumber?: string | null;
  brokerage?: string | null;
  statesLicensed?: string[] | null;
  zipCoverage?: string[] | null;
  coverageLocations?: { label: string; zipCodes: string[] }[] | null;
  npsScore?: number | null;
  notes?: NoteRecord[] | null;
  specialties?: string[] | null;
  languages?: string[] | null;
  ahaDesignation?: 'AHA' | 'AHA_OOS' | null;
};

type LenderLean = {
  _id: Types.ObjectId;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  nmlsId?: string | null;
  team?: string | null;
  region?: string | null;
  licensedStates?: string[] | null;
  notes?: NoteRecord[] | null;
};

export async function getAgentProfile(id: string): Promise<AgentProfile | null> {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'mc')) {
    return null;
  }

  await connectMongo();
  const agent = await Agent.findById(id).lean<AgentLean>();
  if (!agent) {
    return null;
  }

  const metricsMap = await computeAgentMetrics(
    [agent._id],
    new Map([[agent._id.toString(), agent.npsScore ?? null]])
  );
  const metrics = metricsMap.get(agent._id.toString()) ?? {
    ...EMPTY_AGENT_METRICS,
    npsScore: agent.npsScore ?? null
  };

  const referralDocs = await Referral.find({ assignedAgent: agent._id })
    .select('_id borrower loanFileNumber propertyAddress')
    .lean<{
      _id: Types.ObjectId;
      borrower?: { name?: string | null } | null;
      loanFileNumber?: string | null;
      propertyAddress?: string | null;
    }[]>();

  const referralMeta = new Map<
    string,
    { borrowerName: string | null; loanFileNumber: string | null; propertyAddress: string | null }
  >();
  const referralIds: Types.ObjectId[] = [];

  referralDocs.forEach((doc) => {
    referralIds.push(doc._id);
    referralMeta.set(doc._id.toString(), {
      borrowerName: doc.borrower?.name ?? null,
      loanFileNumber: doc.loanFileNumber ?? null,
      propertyAddress: doc.propertyAddress ?? null,
    });
  });

  let deals: PersonDealSnapshot[] = [];

  if (referralIds.length > 0) {
    const paymentDocs = await Payment.find({ referralId: { $in: referralIds } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<{
        _id: Types.ObjectId;
        referralId: Types.ObjectId | string;
        status?: DealStatus | string | null;
        expectedAmountCents?: number | null;
        receivedAmountCents?: number | null;
        usedAfc?: boolean | null;
        usedAssignedAgent?: boolean | null;
        updatedAt?: Date | string | null;
      }[]>();

    deals = paymentDocs.map((payment) => {
      const referralIdString =
        payment.referralId instanceof Types.ObjectId
          ? payment.referralId.toString()
          : typeof payment.referralId === 'string'
          ? payment.referralId
          : '';
      const meta = referralMeta.get(referralIdString);

      const updatedAtIso = (() => {
        if (!payment.updatedAt) {
          return null;
        }
        if (payment.updatedAt instanceof Date) {
          return payment.updatedAt.toISOString();
        }
        const parsed = new Date(payment.updatedAt);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
      })();

      return {
        id: payment._id.toString(),
        referralId: referralIdString,
        borrowerName: meta?.borrowerName ?? null,
        loanFileNumber: meta?.loanFileNumber ?? null,
        propertyAddress: meta?.propertyAddress ?? null,
        status: payment.status ?? null,
        expectedAmountCents: payment.expectedAmountCents ?? 0,
        receivedAmountCents: payment.receivedAmountCents ?? 0,
        usedAfc: payment.usedAfc ?? null,
        usedAssignedAgent: payment.usedAssignedAgent ?? null,
        updatedAt: updatedAtIso,
        agent: {
          id: agent._id.toString(),
          name: agent.name ?? null,
        },
      } satisfies PersonDealSnapshot;
    });
  }

  return {
    _id: agent._id.toString(),
    name: agent.name ?? '',
    email: agent.email ?? '',
    phone: agent.phone ?? undefined,
    licenseNumber: agent.licenseNumber ?? undefined,
    brokerage: agent.brokerage ?? undefined,
    statesLicensed: Array.isArray(agent.statesLicensed) ? agent.statesLicensed : undefined,
    coverageAreas: Array.isArray(agent.zipCoverage) ? agent.zipCoverage : undefined,
    coverageLocations: Array.isArray(agent.coverageLocations) ? agent.coverageLocations : undefined,
    specialties: Array.isArray(agent.specialties) ? agent.specialties : undefined,
    languages: Array.isArray(agent.languages) ? agent.languages : undefined,
    ahaDesignation:
      agent.ahaDesignation === 'AHA' || agent.ahaDesignation === 'AHA_OOS'
        ? agent.ahaDesignation
        : null,
    metrics,
    notes: serializeNotes(agent.notes),
    deals,
  };
}

export async function getLenderProfile(id: string): Promise<LenderProfile | null> {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'agent')) {
    return null;
  }

  await connectMongo();
  const lender = await LenderMC.findById(id).lean<LenderLean>();
  if (!lender) {
    return null;
  }

  const referralDocs = await Referral.find({ lender: lender._id })
    .select('_id borrower loanFileNumber propertyAddress assignedAgent')
    .lean<{
      _id: Types.ObjectId;
      borrower?: { name?: string | null } | null;
      loanFileNumber?: string | null;
      propertyAddress?: string | null;
      assignedAgent?: Types.ObjectId | string | null;
    }[]>();

  const referralMeta = new Map<
    string,
    {
      borrowerName: string | null;
      loanFileNumber: string | null;
      propertyAddress: string | null;
      assignedAgentId: string | null;
    }
  >();
  const referralIds: Types.ObjectId[] = [];
  const assignedAgentIds = new Set<string>();

  referralDocs.forEach((doc) => {
    referralIds.push(doc._id);
    const assignedAgentId =
      typeof doc.assignedAgent === 'string'
        ? doc.assignedAgent
        : doc.assignedAgent instanceof Types.ObjectId
        ? doc.assignedAgent.toString()
        : null;

    if (assignedAgentId) {
      assignedAgentIds.add(assignedAgentId);
    }

    referralMeta.set(doc._id.toString(), {
      borrowerName: doc.borrower?.name ?? null,
      loanFileNumber: doc.loanFileNumber ?? null,
      propertyAddress: doc.propertyAddress ?? null,
      assignedAgentId,
    });
  });

  const agentNameMap = new Map<string, string>();

  if (assignedAgentIds.size > 0) {
    const objectIds: Types.ObjectId[] = [];
    assignedAgentIds.forEach((value) => {
      if (Types.ObjectId.isValid(value)) {
        objectIds.push(new Types.ObjectId(value));
      }
    });

    if (objectIds.length > 0) {
      const agents = await Agent.find({ _id: { $in: objectIds } })
        .select('name')
        .lean<{ _id: Types.ObjectId; name?: string | null }[]>();

      agents.forEach((agent) => {
        agentNameMap.set(agent._id.toString(), agent.name ?? '');
      });
    }
  }

  let deals: PersonDealSnapshot[] = [];

  if (referralIds.length > 0) {
    const paymentDocs = await Payment.find({ referralId: { $in: referralIds } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<{
        _id: Types.ObjectId;
        referralId: Types.ObjectId | string;
        status?: DealStatus | string | null;
        expectedAmountCents?: number | null;
        receivedAmountCents?: number | null;
        usedAfc?: boolean | null;
        usedAssignedAgent?: boolean | null;
        updatedAt?: Date | string | null;
      }[]>();

    deals = paymentDocs.map((payment) => {
      const referralIdString =
        payment.referralId instanceof Types.ObjectId
          ? payment.referralId.toString()
          : typeof payment.referralId === 'string'
          ? payment.referralId
          : '';
      const meta = referralMeta.get(referralIdString);

      const updatedAtIso = (() => {
        if (!payment.updatedAt) {
          return null;
        }
        if (payment.updatedAt instanceof Date) {
          return payment.updatedAt.toISOString();
        }
        const parsed = new Date(payment.updatedAt);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
      })();

      const assignedAgentId = meta?.assignedAgentId ?? null;

      return {
        id: payment._id.toString(),
        referralId: referralIdString,
        borrowerName: meta?.borrowerName ?? null,
        loanFileNumber: meta?.loanFileNumber ?? null,
        propertyAddress: meta?.propertyAddress ?? null,
        status: payment.status ?? null,
        expectedAmountCents: payment.expectedAmountCents ?? 0,
        receivedAmountCents: payment.receivedAmountCents ?? 0,
        usedAfc: payment.usedAfc ?? null,
        usedAssignedAgent: payment.usedAssignedAgent ?? null,
        updatedAt: updatedAtIso,
        agent: assignedAgentId
          ? {
              id: assignedAgentId,
              name: agentNameMap.get(assignedAgentId) ?? null,
            }
          : null,
      } satisfies PersonDealSnapshot;
    });
  }

  return {
    _id: lender._id.toString(),
    name: lender.name ?? '',
    email: lender.email ?? '',
    phone: lender.phone ?? undefined,
    nmlsId: lender.nmlsId ?? undefined,
    team: lender.team ?? null,
    region: lender.region ?? null,
    licensedStates: Array.isArray(lender.licensedStates) ? lender.licensedStates : undefined,
    notes: serializeNotes(lender.notes),
    deals,
  };
}
