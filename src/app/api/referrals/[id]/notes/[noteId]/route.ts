import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { getCurrentSession } from '@/lib/auth';
import { canViewReferral } from '@/lib/rbac';
import { logReferralActivity } from '@/lib/server/activities';
import { updateReferralNoteSchema } from '@/utils/validators';

interface Params {
  params: { id: string; noteId: string };
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // Only admins and managers can delete notes
  if (session.user.role !== 'admin' && session.user.role !== 'manager') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();

  const referral = await Referral.findById(params.id);
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Find the note to get its content for activity logging
  const note = referral.notes?.find((n: any) => n._id.toString() === params.noteId);
  if (!note) {
    return new NextResponse('Note not found', { status: 404 });
  }

  const noteContent = note.content || '';
  const noteAuthorName = note.authorName || 'Unknown';

  // Use $pull to remove the note from the array
  const noteObjectId = new Types.ObjectId(params.noteId);
  await Referral.findByIdAndUpdate(params.id, {
    $pull: { notes: { _id: noteObjectId } }
  });

  // Log activity
  await logReferralActivity({
    referralId: referral._id,
    actorRole: session.user.role,
    actorId: session.user.id,
    channel: 'note',
    content: `Deleted note by ${noteAuthorName}: ${noteContent.substring(0, 100)}${noteContent.length > 100 ? '...' : ''}`
  });

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = updateReferralNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();

  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId name email')
    .populate('buySideAgent', 'userId name email')
    .populate('sellSideAgent', 'userId name email')
    .populate('lender', 'userId name email');
  if (!referral) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (
    !canViewReferral(session, {
      assignedAgent: referral.assignedAgent,
      buySideAgent: referral.buySideAgent,
      sellSideAgent: referral.sellSideAgent,
      lender: referral.lender,
      org: referral.org
    })
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Find the note index
  const noteIndex = referral.notes?.findIndex((n: any) => n._id.toString() === params.noteId);
  if (noteIndex === undefined || noteIndex === -1) {
    return new NextResponse('Note not found', { status: 404 });
  }

  const note = referral.notes[noteIndex] as any;
  const noteAuthorName = note.authorName || 'Unknown';

  // Only admins/managers can edit visibility settings or pin notes
  const isAdminOrManager = session.user.role === 'admin' || session.user.role === 'manager';

  if (parsed.data.pinned !== undefined && !isAdminOrManager) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const contentChanged = parsed.data.content !== undefined;
  if (contentChanged) {
    note.content = parsed.data.content;
  }

  const pinChanged = parsed.data.pinned !== undefined && Boolean(note.pinned) !== parsed.data.pinned;
  if (parsed.data.pinned !== undefined) {
    note.pinned = parsed.data.pinned;
    note.pinnedAt = parsed.data.pinned ? note.pinnedAt ?? new Date() : null;
  }

  if (isAdminOrManager) {
    if (parsed.data.hiddenFromAgent !== undefined) {
      note.hiddenFromAgent = parsed.data.hiddenFromAgent;
    }
    if (parsed.data.hiddenFromMc !== undefined) {
      note.hiddenFromMc = parsed.data.hiddenFromMc;
    }
  }

  referral.markModified('notes');
  await referral.save();

  const noteContent: string = note.content || '';
  const contentPreview = `${noteContent.substring(0, 100)}${noteContent.length > 100 ? '...' : ''}`;

  if (contentChanged) {
    await logReferralActivity({
      referralId: referral._id,
      actorRole: session.user.role,
      actorId: session.user.id,
      channel: 'note',
      content: `Edited note by ${noteAuthorName}: ${contentPreview}`
    });
  }

  if (pinChanged) {
    await logReferralActivity({
      referralId: referral._id,
      actorRole: session.user.role,
      actorId: session.user.id,
      channel: 'note',
      content: `${parsed.data.pinned ? 'Pinned' : 'Unpinned'} note by ${noteAuthorName}: ${contentPreview}`
    });
  }

  const updatedNote = referral.notes[noteIndex] as any;

  return NextResponse.json({
    id: updatedNote._id.toString(),
    authorName: updatedNote.authorName,
    authorRole: updatedNote.authorRole,
    content: updatedNote.content,
    createdAt: updatedNote.createdAt instanceof Date ? updatedNote.createdAt.toISOString() : new Date(updatedNote.createdAt).toISOString(),
    hiddenFromAgent: updatedNote.hiddenFromAgent,
    hiddenFromMc: updatedNote.hiddenFromMc,
    emailedTargets: Array.isArray(updatedNote.emailedTargets) ? updatedNote.emailedTargets : [],
    pinned: Boolean(updatedNote.pinned),
    pinnedAt: updatedNote.pinnedAt ? new Date(updatedNote.pinnedAt).toISOString() : null
  });
}
