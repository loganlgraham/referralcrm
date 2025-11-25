import { formatInTimeZone } from 'date-fns-tz';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

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
  frequency: z.enum(['daily', 'weekly']),
  tasks: z.array(taskSchema).min(1),
});

const formatDueDate = (value?: string | null): string | null => {
  if (!value) return null;
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
  } catch (error) {
    return new Date(value).toLocaleString();
  }
};

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

  if (!isTransactionalEmailConfigured()) {
    return NextResponse.json({ error: 'Task reminder email is not configured.' }, { status: 503 });
  }

  const recipient = session.user.email;
  if (!recipient) {
    return NextResponse.json({ error: 'Your account is missing an email address.' }, { status: 400 });
  }

  const { frequency, tasks } = parsed.data;
  const cadenceLabel = frequency === 'daily' ? 'Daily' : 'Weekly';

  const taskListHtml = tasks
    .map((task) => {
      const due = formatDueDate(task.dueAt ?? undefined);
      const referral = task.referralName ? `<div style="color:#475569;font-size:12px;">Referral: ${task.referralName}</div>` : '';
      const dueHtml = due ? `<div style="color:#475569;font-size:12px;">Due: ${due}</div>` : '';
      const priority = task.priority
        ? `<span style="font-weight:600;text-transform:uppercase;font-size:12px;color:#0f172a;">${task.priority}</span>`
        : '';
      const category = task.category ? `<span style="color:#475569;font-size:12px;">${task.category}</span>` : '';
      return `<li style="margin-bottom:12px;"><div style="font-weight:600;color:#0f172a;">${task.title}</div><div style="color:#334155;font-size:14px;">${task.message ?? ''}</div><div style="display:flex;gap:8px;align-items:center;margin-top:6px;">${priority}${category}</div>${dueHtml}${referral}</li>`;
    })
    .join('');

  const taskListText = tasks
    .map((task) => {
      const due = formatDueDate(task.dueAt ?? undefined);
      const details = [
        task.category,
        task.priority,
        due ? `Due: ${due}` : null,
        task.referralName ? `Referral: ${task.referralName}` : null,
      ]
        .filter(Boolean)
        .join(' | ');
      return `- ${task.title}${details ? ` (${details})` : ''}${task.message ? `\n  ${task.message}` : ''}`;
    })
    .join('\n');

  const delivered = await sendTransactionalEmail({
    to: [recipient],
    subject: `${cadenceLabel} follow-up task reminders`,
    html: `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:640px;color:#0f172a;line-height:1.5;">
      <h2 style="font-size:20px;margin-bottom:8px;">${cadenceLabel} follow-up task reminders</h2>
      <p style="margin:0 0 12px 0;">Here are your outstanding tasks. You'll keep receiving ${frequency} reminders while this setting is enabled.</p>
      <ul style="padding-left:16px;margin:0;">${taskListHtml}</ul>
    </div>`,
    text: `${cadenceLabel} follow-up task reminders\n\nHere are your outstanding tasks:\n${taskListText}`,
  });

  if (!delivered) {
    return NextResponse.json({ error: 'Unable to send reminder email.' }, { status: 502 });
  }

  return NextResponse.json({ delivered: true });
}
