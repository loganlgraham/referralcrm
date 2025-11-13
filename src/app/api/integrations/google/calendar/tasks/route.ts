import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentSession } from '@/lib/auth';
import {
  addTasksToCalendar,
  GoogleCalendarAccountNotLinkedError,
  GoogleCalendarApiError,
  GoogleCalendarInsufficientScopeError,
  GoogleCalendarMissingRefreshTokenError,
  GoogleCalendarNotConfiguredError,
} from '@/lib/google-calendar';

const taskSchema = z.object({
  taskId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  message: z.string().trim().optional(),
  dueAt: z.string().trim().optional().or(z.null()).optional(),
  referralName: z.string().trim().optional().or(z.null()).optional(),
  priority: z.string().trim().optional(),
  category: z.string().trim().optional(),
});

const payloadSchema = z.object({
  tasks: z.array(taskSchema).min(1),
});

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    const result = await addTasksToCalendar(session.user.id, parsed.data.tasks);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GoogleCalendarNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (
      error instanceof GoogleCalendarAccountNotLinkedError ||
      error instanceof GoogleCalendarMissingRefreshTokenError ||
      error instanceof GoogleCalendarInsufficientScopeError
    ) {
      return NextResponse.json({ error: error.message }, { status: 412 });
    }
    if (error instanceof GoogleCalendarApiError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error('Failed to add Google Calendar events for follow-up tasks', error);
    return NextResponse.json(
      { error: 'Unable to add tasks to Google Calendar. Please try again later.' },
      { status: 500 }
    );
  }
}
