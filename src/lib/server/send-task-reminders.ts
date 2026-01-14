import { formatInTimeZone } from 'date-fns-tz';
import type { Session } from 'next-auth';

import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { Referral } from '@/models/referral';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

export type ReminderTask = {
  taskId: string;
  referralId: string;
  title: string;
  message?: string | null;
  dueAt?: string | null;
  referralName?: string | null;
  priority?: string | null;
  category?: string | null;
  dealSide?: 'buy' | 'sell';
};

const formatDueDate = (value?: string | null): string | null => {
  if (!value) return null;
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
  } catch (error) {
    return new Date(value).toLocaleString();
  }
};

/**
 * Sort tasks chronologically by importance:
 * 1. Tasks with dueAt dates first (earliest first)
 * 2. Then by priority (if available)
 * 3. Tasks without dueAt dates last
 */
function sortTasksByImportance(tasks: ReminderTask[]): ReminderTask[] {
  return [...tasks].sort((a, b) => {
    // Tasks with dueAt come before tasks without
    const aHasDue = a.dueAt != null;
    const bHasDue = b.dueAt != null;
    if (aHasDue && !bHasDue) return -1;
    if (!aHasDue && bHasDue) return 1;

    // If both have dueAt, sort by date (earliest first)
    if (aHasDue && bHasDue) {
      const aDate = new Date(a.dueAt!).getTime();
      const bDate = new Date(b.dueAt!).getTime();
      if (aDate !== bDate) return aDate - bDate;
    }

    // Then sort by priority (if available)
    // Priority order: high > medium > low (or any custom priority values)
    const priorityOrder: Record<string, number> = { high: 1, medium: 2, low: 3 };
    const aPriority = a.priority?.toLowerCase() || '';
    const bPriority = b.priority?.toLowerCase() || '';
    const aPriorityOrder = priorityOrder[aPriority] ?? 999;
    const bPriorityOrder = priorityOrder[bPriority] ?? 999;
    if (aPriorityOrder !== bPriorityOrder) return aPriorityOrder - bPriorityOrder;

    // Finally, sort by title alphabetically
    return (a.title || '').localeCompare(b.title || '');
  });
}

/**
 * Filter tasks based on agent role if needed
 */
async function filterTasksByAgentRole(
  tasks: ReminderTask[],
  isAutomationRequest: boolean,
  session: Session | null
): Promise<ReminderTask[]> {
  if (isAutomationRequest || !session?.user?.id || session.user.role !== 'agent') {
    return tasks;
  }

  await connectMongo();

  const referralIds = Array.from(new Set(tasks.map((task) => task.referralId)));
  const referrals = await Referral.find({ _id: { $in: referralIds } })
    .select('dealSide buySideAgent sellSideAgent')
    .populate('buySideAgent', 'userId name')
    .populate('sellSideAgent', 'userId name')
    .lean<{ _id: string; dealSide?: string; buySideAgent?: any; sellSideAgent?: any }[]>();

  const referralMap = new Map(referrals.map((item) => [item._id.toString(), item]));

  return tasks.filter((task) => {
    const referral = referralMap.get(task.referralId);
    if (!referral) return false;

    const side: 'buy' | 'sell' = referral.dealSide === 'sell' ? 'sell' : 'buy';
    const isBuySideAgent = referral.buySideAgent && 'userId' in referral.buySideAgent
      ? String(referral.buySideAgent.userId) === session.user.id
      : false;
    const isSellSideAgent = referral.sellSideAgent && 'userId' in referral.sellSideAgent
      ? String(referral.sellSideAgent.userId) === session.user.id
      : false;

    return (side === 'buy' && isBuySideAgent) || (side === 'sell' && isSellSideAgent);
  });
}

/**
 * Send task reminder email with all tasks in chronological order
 */
export async function sendTaskReminders(params: {
  tasks: ReminderTask[];
  recipient: string;
  frequency: 'daily' | 'weekly';
  origin: string;
  isAutomationRequest: boolean;
  session?: Session | null;
}): Promise<{ success: boolean; error?: string }> {
  const { tasks, recipient, frequency, origin, isAutomationRequest, session } = params;

  if (!isTransactionalEmailConfigured()) {
    return { success: false, error: 'Task reminder email is not configured.' };
  }

  // Filter tasks by agent role if needed
  const filteredTasks = await filterTasksByAgentRole(tasks, isAutomationRequest, session || null);

  if (filteredTasks.length === 0) {
    return { success: false, error: 'No eligible tasks to send for your assignment.' };
  }

  // Sort tasks chronologically by importance
  const sortedTasks = sortTasksByImportance(filteredTasks);

  const cadenceLabel = frequency === 'daily' ? 'Daily' : 'Weekly';
  const scheduleText = frequency === 'weekly' ? 'Mondays at 8:00 AM MT' : '8:00 AM MT each day';
  const returnToPath = '/referrals/follow-ups';

  const buildCompletionUrl = (taskIds: string[]) => {
    const url = new URL('/task-reminders/complete', origin);
    taskIds.forEach((taskId) => url.searchParams.append('taskId', taskId));
    url.searchParams.set('returnTo', returnToPath);
    return url.toString();
  };

  const completeAllUrl = buildCompletionUrl(sortedTasks.map((task) => task.taskId));

  // Generate HTML email with tasks in chronological order (flat list)
  const tasksHtml = sortedTasks
    .map((task) => {
      const due = formatDueDate(task.dueAt ?? undefined);
      const dueHtml = due ? `<div style="color:#475569;font-size:12px;">Due: ${due}</div>` : '';
      const priority = task.priority
        ? `<div style="font-weight:600;text-transform:uppercase;font-size:12px;color:#0f172a;">${task.priority}</div>`
        : '';
      const message = task.message ? `<div style="color:#334155;font-size:14px;margin-top:4px;">${task.message}</div>` : '';
      const referralName = task.referralName ? `<div style="color:#64748b;font-size:12px;margin-bottom:4px;">${task.referralName}</div>` : '';
      const completeHref = buildCompletionUrl([task.taskId]);
      const completionLink = `<a href="${completeHref}" style="display:inline-flex;align-items:center;margin-top:10px;font-weight:600;color:#0f172a;text-decoration:underline;">Mark complete from email</a>`;
      return `<li style="margin-bottom:12px;padding:10px;border:1px solid #e2e8f0;border-radius:12px;">` +
        `${referralName}` +
        `<div style="font-weight:700;color:#0f172a;font-size:15px;">${task.title}</div>` +
        `${message}` +
        `${priority}` +
        `${dueHtml}` +
        `${completionLink}` +
        `</li>`;
    })
    .join('');

  // Generate text email with tasks in chronological order (flat list)
  const taskLines = sortedTasks
    .map((task) => {
      const due = formatDueDate(task.dueAt ?? undefined);
      const details = [task.priority ? `Urgency: ${task.priority}` : null, due ? `Due: ${due}` : null]
        .filter(Boolean)
        .join(' | ');
      const completionLink = buildCompletionUrl([task.taskId]);
      const referralName = task.referralName ? `${task.referralName} - ` : '';
      return `- ${referralName}${task.title}${details ? ` (${details})` : ''}${task.message ? `\n  ${task.message}` : ''}\n  Complete: ${completionLink}`;
    })
    .join('\n');

  const delivered = await sendTransactionalEmail({
    to: [recipient],
    subject: `${cadenceLabel} follow-up task reminders`,
    html: `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:640px;color:#0f172a;line-height:1.5;">
      <h2 style="font-size:20px;margin-bottom:8px;">${cadenceLabel} follow-up task reminders</h2>
      <p style="margin:0 0 12px 0;">Here are your outstanding tasks. You'll keep receiving ${frequency} reminders at ${scheduleText} while this setting is enabled.</p>
      <ul style="padding-left:18px;margin:0;list-style-type:disc;">${tasksHtml}</ul>
      <p style="margin:12px 0 0 0;font-weight:700;">Ready to clear the deck?</p>
      <a href="${completeAllUrl}" style="display:inline-block;margin-top:8px;padding:10px 16px;border-radius:10px;background:#0f172a;color:#fff;font-weight:700;text-decoration:none;">Mark all tasks complete</a>
    </div>`,
    text: `${cadenceLabel} follow-up task reminders\n\nHere are your outstanding tasks:\n${taskLines}\n\nComplete every task: ${completeAllUrl}`,
  });

  if (!delivered) {
    return { success: false, error: 'Unable to send reminder email.' };
  }

  return { success: true };
}
