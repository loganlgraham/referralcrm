import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';
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
  metrics: AgentMetricsSummary;
  notes: NoteSummary[];
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
    metrics,
    notes: serializeNotes(agent.notes)
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

  return {
    _id: lender._id.toString(),
    name: lender.name ?? '',
    email: lender.email ?? '',
    phone: lender.phone ?? undefined,
    nmlsId: lender.nmlsId ?? undefined,
    team: lender.team ?? null,
    region: lender.region ?? null,
    licensedStates: Array.isArray(lender.licensedStates) ? lender.licensedStates : undefined,
    notes: serializeNotes(lender.notes)
  };
}
