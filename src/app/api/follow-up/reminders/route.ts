import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured } from '@/lib/email';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { Referral } from '@/models/referral';
import { sendTaskReminders, type ReminderTask } from '@/lib/server/send-task-reminders';
import { getAppOrigin } from '@/lib/server/app-origin';

const taskSchema = z.object({
  taskId: z.string().trim().min(1),
  referralId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  message: z.string().trim().optional(),
  dueAt: z.string().trim().optional().or(z.null()).optional(),
  referralName: z.string().trim().optional().or(z.null()).optional(),
  priority: z.string().trim().optional(),
  category: z.string().trim().optional(),
});

const payloadSchema = z.object({
  frequency: z.enum(['daily', 'weekly']),
  tasks: z.array(taskSchema).min(1),
  recipient: z.string().trim().email().optional(),
});

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const automationSecret = process.env.TASK_REMINDER_SECRET?.trim();
  const rawHeaderValue = request.headers.get('x-task-reminder-secret');
  const headerValue = rawHeaderValue?.trim() ?? null;
  
  // Compare trimmed values for better reliability
  const isAutomationRequest = Boolean(
    automationSecret && headerValue && headerValue === automationSecret
  );

  const session = await getCurrentSession();
  if (!isAutomationRequest && !session?.user?.id) {
    // Return specific error messages to help diagnose the issue
    let errorMessage = 'Unauthorized';
    if (!automationSecret) {
      errorMessage = 'Automation secret not configured';
    } else if (!headerValue) {
      errorMessage = 'Missing authentication header';
    } else if (headerValue !== automationSecret) {
      errorMessage = 'Invalid authentication secret';
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (!isTransactionalEmailConfigured()) {
    return NextResponse.json({ error: 'Task reminder email is not configured.' }, { status: 503 });
  }

  const { frequency, tasks, recipient: overrideRecipient } = parsed.data;
  const recipient = isAutomationRequest ? overrideRecipient : session?.user?.email ?? null;
  if (!recipient) {
    const message = isAutomationRequest
      ? 'Recipient email address is required for automated reminders.'
      : 'Your account is missing an email address.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (isAutomationRequest && !automationSecret) {
    return NextResponse.json({ error: 'Automated reminders are not configured.' }, { status: 503 });
  }

  await connectMongo();

  // Check agent account exists for non-automation requests
  if (!isAutomationRequest && session?.user?.role === 'agent') {
    const agentRecord = await Agent.findOne({ userId: session.user.id }).select('_id').lean();
    if (!agentRecord) {
      return NextResponse.json({ error: 'Agent account not found.' }, { status: 403 });
    }
  }

  // Enrich tasks with referral names
  const referralIds = Array.from(new Set(tasks.map((task) => task.referralId)));
  const referrals = await Referral.find({ _id: { $in: referralIds } })
    .select('borrower')
    .lean<{ _id: string; borrower?: { name?: string } }[]>();

  const referralMap = new Map(referrals.map((item) => [item._id.toString(), item]));

  const enrichedTasks: ReminderTask[] = tasks.map((task) => {
    const referral = referralMap.get(task.referralId);
    return {
      ...task,
      referralName: task.referralName ?? referral?.borrower?.name ?? null,
    };
  });

  const origin = getAppOrigin(request);
  const result = await sendTaskReminders({
    tasks: enrichedTasks,
    recipient,
    frequency,
    origin,
    isAutomationRequest,
    session: session || null,
  });

  if (!result.success) {
    if (result.error === 'Task reminder email is not configured.') {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }
    if (result.error === 'No eligible tasks to send for your assignment.') {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    if (result.error === 'Unable to send reminder email.') {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ error: result.error || 'Failed to send reminders' }, { status: 500 });
  }

  return NextResponse.json({ delivered: true });
}
