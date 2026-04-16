import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentSession } from '@/lib/auth';
import { cleanReferralNotes } from '@/lib/server/referral-notes-cleanup';

interface Params {
  params: { id: string };
}

const requestSchema = z.object({
  notes: z.string().min(1).max(2000),
});

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const allowedRoles = new Set(['admin', 'manager']);
  if (!allowedRoles.has(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Note cleanup is not configured.' },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request.', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { notes } = parsed.data;

  try {
    const cleanedNotes = await cleanReferralNotes(notes);
    if (!cleanedNotes) {
      return NextResponse.json(
        { error: 'No response from cleanup service.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ cleanedNotes });
  } catch (error) {
    console.error('Note cleanup error', error);
    return NextResponse.json(
      { error: 'Failed to clean up notes.' },
      { status: 500 }
    );
  }
}

