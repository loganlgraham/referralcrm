import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { createLenderNoteSchema } from '@/utils/validators';
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
  const parsed = createLenderNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const lender = await LenderMC.findById(params.id);
  if (!lender) {
    return new NextResponse('Not found', { status: 404 });
  }

  const note = {
    author: session.user.id as any,
    authorName: session.user.name || session.user.email || 'Admin',
    authorRole: session.user.role,
    content: parsed.data.content,
    hiddenFromMc: true,
    createdAt: new Date()
  } as any;

  lender.notes = lender.notes || [];
  lender.notes.push(note);
  await lender.save();

  const saved = lender.notes[lender.notes.length - 1];

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
