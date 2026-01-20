import { NextResponse } from 'next/server';
import { z } from 'zod';

import { markFollowUpTaskCompletions } from '@/lib/server/follow-up-task-store';

const completionSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsed = completionSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const updated = markFollowUpTaskCompletions(parsed.data.taskIds);

  return NextResponse.json({ success: true, updated });
}
