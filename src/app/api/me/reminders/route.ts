import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { User } from '@/models/user';

const updateSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(['daily', 'weekly']),
});

export async function PUT(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const json = await request.json().catch(() => null);
    const parsed = updateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    await connectMongo();

    await User.findByIdAndUpdate(session.user.id, {
      reminderEnabled: parsed.data.enabled,
      reminderFrequency: parsed.data.frequency,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API /api/me/reminders] Error updating reminder settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await connectMongo();
    const user = await User.findById(session.user.id)
      .select('reminderEnabled reminderFrequency')
      .lean<{ reminderEnabled?: boolean; reminderFrequency?: 'daily' | 'weekly' } | null>();

    return NextResponse.json({
      enabled: user?.reminderEnabled ?? false,
      frequency: user?.reminderFrequency ?? 'daily',
    });
  } catch (error) {
    console.error('[API /api/me/reminders] Error fetching reminder settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

