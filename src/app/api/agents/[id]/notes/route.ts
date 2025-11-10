import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { createAgentNoteSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';

interface Params {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'manager')) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json();
  const parsed = createAgentNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const agent = await Agent.findById(params.id);
  if (!agent) {
    return new NextResponse('Not found', { status: 404 });
  }

  const note = {
    author: session.user.id as any,
    authorName: session.user.name || session.user.email || 'Admin',
    authorRole: session.user.role,
    content: parsed.data.content,
    hiddenFromAgent: true,
    createdAt: new Date()
  } as any;

  agent.notes = agent.notes || [];
  agent.notes.push(note);
  await agent.save();

  const saved = agent.notes[agent.notes.length - 1];

  return NextResponse.json(
    {
      id: saved._id.toString(),
      authorName: saved.authorName,
      authorRole: saved.authorRole,
      content: saved.content,
      createdAt: saved.createdAt
    },
    { status: 201 }
  );
}
