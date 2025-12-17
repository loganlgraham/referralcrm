import { NextRequest, NextResponse } from 'next/server';

import { getReferralAppBaseUrl } from '@/lib/referral-links';
import { connectMongo } from '@/lib/mongoose';
import { collectReminderCandidates } from '@/lib/server/follow-up-reminders';
import { TaskReminderRun } from '@/models/task-reminder-run';

export const runtime = 'nodejs';

const parseFrequency = (value: string | null): 'daily' | 'weekly' => {
  return value === 'weekly' ? 'weekly' : 'daily';
};

export async function GET(request: NextRequest) {
  const automationSecret = process.env.TASK_REMINDER_SECRET;
  const providedSecret = request.headers.get('x-task-reminder-secret') ?? request.nextUrl.searchParams.get('token');
  const isCronRequest = Boolean(request.headers.get('x-vercel-cron'));

  if (automationSecret && !isCronRequest && providedSecret !== automationSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const frequency = parseFrequency(
    request.nextUrl.searchParams.get('frequency') ?? process.env.TASK_REMINDER_FREQUENCY ?? 'daily'
  );
  const reminderEndpoint =
    process.env.TASK_REMINDER_ENDPOINT ?? `${getReferralAppBaseUrl()}/api/follow-up/reminders`;

  const candidates = await collectReminderCandidates();
  const recipients: {
    userId: string;
    email: string;
    role: string;
    taskCount: number;
    status: 'sent' | 'failed';
    error?: string;
  }[] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const candidate of candidates) {
    try {
      const response = await fetch(reminderEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(automationSecret ? { 'x-task-reminder-secret': automationSecret } : {}),
        },
        body: JSON.stringify({
          frequency,
          tasks: candidate.tasks,
          recipient: candidate.user.email,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Failed to queue reminder email');
      }

      successCount += 1;
      recipients.push({
        userId: candidate.user._id,
        email: candidate.user.email,
        role: candidate.user.role,
        taskCount: candidate.tasks.length,
        status: 'sent',
      });
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : 'Unknown error';
      recipients.push({
        userId: candidate.user._id,
        email: candidate.user.email,
        role: candidate.user.role,
        taskCount: candidate.tasks.length,
        status: 'failed',
        error: message,
      });
      console.error('Failed to deliver automated follow-up reminders', { email: candidate.user.email, error: message });
    }
  }

  await connectMongo();
  await TaskReminderRun.create({
    frequency,
    recipients,
    successCount,
    failureCount,
    completedAt: new Date(),
  });

  console.info('Follow-up reminder cron finished', {
    frequency,
    successCount,
    failureCount,
    recipients: recipients.length,
  });

  return NextResponse.json({
    frequency,
    successCount,
    failureCount,
    recipients: recipients.length,
  });
}
