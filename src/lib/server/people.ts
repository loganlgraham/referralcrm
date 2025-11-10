import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';

type NoteSummary = {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
  emailedTargets: ('agent' | 'mc')[];
};

type AgentProfile = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  statesLicensed?: string[];
  coverageAreas?: string[];
  closings12mo?: number | null;
  closingRatePercentage?: number | null;
  npsScore?: number | null;
  avgResponseHours?: number | null;
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
  emailedTargets?: ('agent' | 'mc')[];
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
  statesLicensed?: string[] | null;
  zipCoverage?: string[] | null;
  closings12mo?: number | null;
  closingRatePercentage?: number | null;
  npsScore?: number | null;
  avgResponseHours?: number | null;
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

  return {
    _id: agent._id.toString(),
    name: agent.name ?? '',
    email: agent.email ?? '',
    phone: agent.phone ?? undefined,
    statesLicensed: Array.isArray(agent.statesLicensed) ? agent.statesLicensed : undefined,
    coverageAreas: Array.isArray(agent.zipCoverage) ? agent.zipCoverage : undefined,
    closings12mo: agent.closings12mo ?? null,
    closingRatePercentage: agent.closingRatePercentage ?? null,
    npsScore: agent.npsScore ?? null,
    avgResponseHours: agent.avgResponseHours ?? null,
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
