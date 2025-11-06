import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';

interface NoteRecord {
  _id: any;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: Date;
}

const serializeNotes = (notes: NoteRecord[] = []) =>
  notes.map((note) => ({
    id: note._id.toString(),
    authorName: note.authorName,
    authorRole: note.authorRole,
    content: note.content,
    createdAt: note.createdAt instanceof Date ? note.createdAt.toISOString() : new Date(note.createdAt).toISOString()
  }));

export async function getAgentProfile(id: string) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'manager')) {
    return null;
  }

  await connectMongo();
  const agent = await Agent.findById(id).lean();
  if (!agent) {
    return null;
  }

  return {
    ...agent,
    _id: agent._id.toString(),
    notes: serializeNotes(agent.notes as unknown as NoteRecord[])
  };
}

export async function getLenderProfile(id: string) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'manager')) {
    return null;
  }

  await connectMongo();
  const lender = await LenderMC.findById(id).lean();
  if (!lender) {
    return null;
  }

  return {
    ...lender,
    _id: lender._id.toString(),
    notes: serializeNotes(lender.notes as unknown as NoteRecord[])
  };
}
