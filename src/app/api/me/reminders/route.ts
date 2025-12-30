import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/session';
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
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectMongo();
  const user = await User.findById(session.user.id)
    .select('reminderEnabled reminderFrequency')
    .lean();

  return NextResponse.json({
    enabled: user?.reminderEnabled ?? false,
    frequency: user?.reminderFrequency ?? 'daily',
  });
}

