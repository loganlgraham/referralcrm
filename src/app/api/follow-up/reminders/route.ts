import { formatInTimeZone } from 'date-fns-tz';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { Referral } from '@/models/referral';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

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
  const scheduleText = frequency === 'weekly' ? 'Mondays at 8:00 AM MT' : '8:00 AM MT each day';
  const origin = new URL(request.url).origin;
  const returnToPath = '/referrals/follow-ups';

  const buildCompletionUrl = (taskIds: string[]) => {
    const url = new URL('/task-reminders/complete', origin);
    taskIds.forEach((taskId) => url.searchParams.append('taskId', taskId));
    url.searchParams.set('returnTo', returnToPath);
    return url.toString();
  };

  await connectMongo();

  const agentRecord =
    session.user.role === 'agent' ? await Agent.findOne({ userId: session.user.id }).select('_id') : null;

  if (session.user.role === 'agent' && !agentRecord?._id) {
    return NextResponse.json({ error: 'Agent account not found.' }, { status: 403 });
  }

  const referralIds = Array.from(new Set(tasks.map((task) => task.referralId)));
  const referrals = await Referral.find({ _id: { $in: referralIds } })
    .select('borrower dealSide buySideAgent sellSideAgent')
    .populate('buySideAgent', 'userId name')
    .populate('sellSideAgent', 'userId name')
    .lean<{ _id: string; dealSide?: string; borrower?: { name?: string }; buySideAgent?: any; sellSideAgent?: any }[]>();

  const referralMap = new Map(referrals.map((item) => [item._id.toString(), item]));

  type ReminderTask = (typeof tasks)[number] & { dealSide?: 'buy' | 'sell' };

  const groupedTasks = tasks.reduce<Record<string, ReminderTask[]>>((acc, task) => {
    const list = acc[task.referralId] ?? [];
    list.push(task);
    acc[task.referralId] = list;
    return acc;
  }, {});

  const allowedTasks = Object.entries(groupedTasks).reduce<ReminderTask[]>((acc, [referralId, referralTasks]) => {
    const referral = referralMap.get(referralId);
    if (!referral) {
      return acc;
    }

    const side: 'buy' | 'sell' = referral.dealSide === 'sell' ? 'sell' : 'buy';

    if (session.user.role === 'agent') {
      const isBuySideAgent = referral.buySideAgent && 'userId' in referral.buySideAgent
        ? String(referral.buySideAgent.userId) === session.user.id
        : false;
      const isSellSideAgent = referral.sellSideAgent && 'userId' in referral.sellSideAgent
        ? String(referral.sellSideAgent.userId) === session.user.id
        : false;

      if ((side === 'buy' && !isBuySideAgent) || (side === 'sell' && !isSellSideAgent)) {
        return acc;
      }
    }

    const decoratedTasks = referralTasks.map<ReminderTask>((task) => ({
      ...task,
      referralName: task.referralName ?? referral.borrower?.name ?? null,
      dealSide: side,
    }));

    acc.push(...decoratedTasks);
    return acc;
  }, []);

  if (allowedTasks.length === 0) {
    return NextResponse.json({ error: 'No eligible tasks to send for your assignment.' }, { status: 403 });
  }

  const sections = allowedTasks.reduce<Record<string, ReminderTask[]>>((acc, task) => {
    const list = acc[task.referralId] ?? [];
    list.push(task);
    acc[task.referralId] = list;
    return acc;
  }, {});

  const completeAllUrl = buildCompletionUrl(allowedTasks.map((task) => task.taskId));

  const taskListHtml = Object.values(sections)
    .map((section) => {
      const referralName = section[0]?.referralName ?? 'Referral';
      const tasksHtml = section
        .map((task) => {
          const due = formatDueDate(task.dueAt ?? undefined);
          const dueHtml = due ? `<div style="color:#475569;font-size:12px;">Due: ${due}</div>` : '';
          const priority = task.priority
            ? `<div style="font-weight:600;text-transform:uppercase;font-size:12px;color:#0f172a;">${task.priority}</div>`
            : '';
          const message = task.message ? `<div style="color:#334155;font-size:14px;margin-top:4px;">${task.message}</div>` : '';
          const completeHref = buildCompletionUrl([task.taskId]);
          const completionLink = `<a href="${completeHref}" style="display:inline-flex;align-items:center;margin-top:10px;font-weight:600;color:#0f172a;text-decoration:underline;">Mark complete from email</a>`;
          return `<li style="margin-bottom:12px;padding:10px;border:1px solid #e2e8f0;border-radius:12px;">` +
            `<div style="font-weight:700;color:#0f172a;font-size:15px;">${task.title}</div>` +
            `${message}` +
            `${priority}` +
            `${dueHtml}` +
            `${completionLink}` +
            `</li>`;
        })
        .join('');
      return `<div style="margin-bottom:18px;">` +
        `<h3 style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:6px;">${referralName}</h3>` +
        `<ul style="padding-left:18px;margin:0;list-style-type:disc;">${tasksHtml}</ul>` +
        `</div>`;
    })
    .join('');

  const taskListText = Object.values(sections)
    .map((section) => {
      const referralName = section[0]?.referralName ?? 'Referral';
      const taskLines = section
        .map((task) => {
          const due = formatDueDate(task.dueAt ?? undefined);
          const details = [task.priority ? `Urgency: ${task.priority}` : null, due ? `Due: ${due}` : null]
            .filter(Boolean)
            .join(' | ');
          const completionLink = buildCompletionUrl([task.taskId]);
          return `- ${task.title}${details ? ` (${details})` : ''}${task.message ? `\n  ${task.message}` : ''}\n  Complete: ${completionLink}`;
        })
        .join('\n');
      return `${referralName}:\n${taskLines}`;
    })
    .join('\n\n');

  const delivered = await sendTransactionalEmail({
    to: [recipient],
    subject: `${cadenceLabel} follow-up task reminders`,
    html: `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:640px;color:#0f172a;line-height:1.5;">
      <h2 style="font-size:20px;margin-bottom:8px;">${cadenceLabel} follow-up task reminders</h2>
      <p style="margin:0 0 12px 0;">Here are your outstanding tasks. You'll keep receiving ${frequency} reminders at ${scheduleText} while this setting is enabled.</p>
      <div style="padding-left:4px;margin:0;">${taskListHtml}</div>
      <p style="margin:12px 0 0 0;font-weight:700;">Ready to clear the deck?</p>
      <a href="${completeAllUrl}" style="display:inline-block;margin-top:8px;padding:10px 16px;border-radius:10px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;">Mark all tasks complete</a>
    </div>`,
    text: `${cadenceLabel} follow-up task reminders\n\nHere are your outstanding tasks:\n${taskListText}\n\nComplete every task: ${completeAllUrl}`,
  });

  if (!delivered) {
    return NextResponse.json({ error: 'Unable to send reminder email.' }, { status: 502 });
  }

  return NextResponse.json({ delivered: true });
}
