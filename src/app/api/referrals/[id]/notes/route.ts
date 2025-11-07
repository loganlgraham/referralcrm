import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { createReferralNoteSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';

interface Params {
  params: { id: string };
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = createReferralNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId')
    .populate('lender', 'userId');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !canViewReferral(session, {
      assignedAgent: referral.assignedAgent,
      lender: referral.lender,
      org: referral.org
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const allowHidden = session.user.role === 'admin' || session.user.role === 'manager';
  const note = {
    author: session.user.id as any,
    authorName: session.user.name || session.user.email || 'Team Member',
    authorRole: session.user.role,
    content: parsed.data.content,
    hiddenFromAgent: allowHidden ? Boolean(parsed.data.hiddenFromAgent) : false,
    hiddenFromMc: allowHidden ? Boolean(parsed.data.hiddenFromMc) : false,
    createdAt: new Date()
  } as any;

  referral.notes = referral.notes || [];
  referral.notes.push(note);
  await referral.save();

  const saved = referral.notes[referral.notes.length - 1];

  return NextResponse.json(
    {
      id: saved._id.toString(),
      createdAt: saved.createdAt,
      authorRole: saved.authorRole,
      authorName: saved.authorName,
      content: saved.content,
      hiddenFromAgent: saved.hiddenFromAgent,
      hiddenFromMc: saved.hiddenFromMc
    },
    { status: 201 }
  );
}
