import { NextRequest, NextResponse } from 'next/server';
import { getDay } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { User } from '@/models/user';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { computeFollowUpTasksForReferral } from '@/lib/server/follow-up-tasks';
import { Types } from 'mongoose';

export const runtime = 'nodejs';

interface ReminderResult {
  userId: string;
  email: string;
  frequency: 'daily' | 'weekly';
  success: boolean;
  taskCount: number;
  error?: string;
}

/**
 * Convert referral document to ReferralLike format for task computation
 */
function toReferralLike(referral: any, payments: any[] = []) {
  // Convert Payment documents to DealLike format expected by SLA insights
  const paymentsFormatted = payments.map((payment: any) => ({
    status: payment.status,
    createdAt: payment.createdAt || referral.createdAt,
    updatedAt: payment.updatedAt || payment.closingDate || referral.updatedAt,
    paidDate: payment.paidDate || (payment.status === 'paid' ? payment.closingDate : null),
  }));

  return {
    _id: referral._id.toString(),
    createdAt: referral.createdAt,
    status: referral.status,
    statusLastUpdated: referral.statusLastUpdated,
    clientType: referral.clientType,
    dealSide: referral.dealSide,
    assignedAgent: referral.assignedAgent
      ? {
          name: referral.assignedAgent?.name,
          fullName: referral.assignedAgent?.name,
        }
      : null,
    assignedAgentName: referral.assignedAgent?.name,
    buySideAgent: referral.buySideAgent
      ? {
          name: referral.buySideAgent?.name,
          fullName: referral.buySideAgent?.name,
        }
      : null,
    sellSideAgent: referral.sellSideAgent
      ? {
          name: referral.sellSideAgent?.name,
          fullName: referral.sellSideAgent?.name,
        }
      : null,
    buySideAgentName: referral.buySideAgent?.name,
    sellSideAgentName: referral.sellSideAgent?.name,
    lender: referral.lender
      ? {
          name: referral.lender?.name,
        }
      : null,
    origin: referral.origin,
    borrower: {
      name: referral.borrower?.name,
    },
    notes: referral.notes || [],
    payments: paymentsFormatted,
    audit: referral.audit || [],
    sla: referral.sla || null,
  };
}

/**
 * Query referrals for a user based on their role
 */
async function getReferralsForUser(userId: string, role: string | null) {
  const query: Record<string, unknown> = { deletedAt: null };

  if (role === 'admin') {
    // Admin users see all referrals
    return Referral.find(query)
      .populate('assignedAgent', 'name')
      .populate('buySideAgent', 'name')
      .populate('sellSideAgent', 'name')
      .populate('lender', 'name')
      .lean();
  }

  if (role === 'mortgage-consultant') {
    const lender = await LenderMC.findOne({ userId }).select('_id').lean();
    if (!lender) {
      return [];
    }
    query.lender = (lender as { _id: Types.ObjectId })._id;
    return Referral.find(query)
      .populate('assignedAgent', 'name')
      .populate('buySideAgent', 'name')
      .populate('sellSideAgent', 'name')
      .populate('lender', 'name')
      .lean();
  }

  if (role === 'agent') {
    const agent = await Agent.findOne({ userId }).select('_id').lean();
    if (!agent) {
      return [];
    }
    const agentId = (agent as { _id: Types.ObjectId })._id;
    // Agent users see referrals where they are assigned, buySideAgent, or sellSideAgent
    return Referral.find({
      ...query,
      $or: [
        { assignedAgent: agentId },
        { buySideAgent: agentId },
        { sellSideAgent: agentId },
      ],
    })
      .populate('assignedAgent', 'name')
      .populate('buySideAgent', 'name')
      .populate('sellSideAgent', 'name')
      .populate('lender', 'name')
      .lean();
  }

  return [];
}

/**
 * Determine viewer role for task filtering
 */
function getViewerRole(role: string | null): 'admin' | 'mc' | 'agent' {
  if (role === 'mortgage-consultant') return 'mc';
  if (role === 'agent') return 'agent';
  return 'admin';
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  // Validate cron secret
  if (!cronSecret) {
    console.error('CRON_SECRET environment variable is not set');
    return NextResponse.json({ error: 'Cron job not configured' }, { status: 503 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectMongo();

  const now = new Date();
  const dayOfWeek = getDay(now); // 0 = Sunday, 1 = Monday, etc.
  const isMonday = dayOfWeek === 1;

  // Query users with reminders enabled
  const users = await User.find({
    reminderEnabled: true,
    email: { $ne: null, $exists: true },
  })
    .select('_id email role reminderFrequency')
    .lean();

  console.log(`Found ${users.length} users with reminders enabled`);

  const results: ReminderResult[] = [];
  const taskReminderSecret = process.env.TASK_REMINDER_SECRET;

  if (!taskReminderSecret) {
    console.error('TASK_REMINDER_SECRET environment variable is not set');
    return NextResponse.json(
      { error: 'Task reminder secret not configured', results: [] },
      { status: 503 }
    );
  }

  // Process each user
  for (const user of users) {
    const frequency = user.reminderFrequency || 'daily';

    // Skip weekly reminders if it's not Monday
    if (frequency === 'weekly' && !isMonday) {
      console.log(`Skipping weekly reminder for ${user.email} (not Monday)`);
      continue;
    }

    // Skip daily reminders if it's Monday and user wants weekly
    // (This shouldn't happen due to the check above, but being explicit)
    if (frequency === 'daily' && isMonday) {
      // Daily reminders run every day including Monday
    }

    try {
      const viewerRole = getViewerRole(user.role);
      const referrals = await getReferralsForUser(user._id.toString(), user.role || null);

      if (referrals.length === 0) {
        console.log(`No referrals found for user ${user.email}`);
        results.push({
          userId: user._id.toString(),
          email: user.email || '',
          frequency,
          success: true,
          taskCount: 0,
        });
        continue;
      }

      // Query payments for all referrals in one query
      const referralIds = referrals.map((r) => r._id);
      const payments = await Payment.find({
        referralId: { $in: referralIds },
      })
        .select('referralId status createdAt updatedAt paidDate closingDate')
        .lean();
      const paymentsByReferralId = new Map<string, typeof payments>();
      for (const payment of payments) {
        const refId = payment.referralId.toString();
        if (!paymentsByReferralId.has(refId)) {
          paymentsByReferralId.set(refId, []);
        }
        paymentsByReferralId.get(refId)!.push(payment);
      }

      // Compute tasks for all referrals
      const allTasks: Array<{
        taskId: string;
        referralId: string;
        title: string;
        message: string;
        dueAt?: string | null;
        referralName?: string;
        priority?: string;
        category?: string;
      }> = [];

      for (const referral of referrals) {
        const referralPayments = paymentsByReferralId.get(referral._id.toString()) || [];
        const referralLike = toReferralLike(referral, referralPayments);
        const tasks = computeFollowUpTasksForReferral(referralLike, viewerRole);

        // Tasks are already filtered by role in computeFollowUpTasksForReferral
        // and referrals are already filtered by role in getReferralsForUser
        for (const task of tasks) {
          allTasks.push({
            taskId: task.taskId,
            referralId: task.referralId,
            title: task.title,
            message: task.message,
            dueAt: task.dueAt ?? null,
            referralName: task.referralName ?? null,
            priority: task.priority,
            category: task.category,
          });
        }
      }

      if (allTasks.length === 0) {
        console.log(`No outstanding tasks for user ${user.email}`);
        results.push({
          userId: user._id.toString(),
          email: user.email || '',
          frequency,
          success: true,
          taskCount: 0,
        });
        continue;
      }

      // Call the reminders API
      // Use VERCEL_URL if available (for serverless), otherwise construct from request
      const baseUrl =
        process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : new URL(request.url).origin;
      const remindersUrl = `${baseUrl}/api/follow-up/reminders`;

      const response = await fetch(remindersUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-task-reminder-secret': taskReminderSecret,
        },
        body: JSON.stringify({
          frequency,
          tasks: allTasks,
          recipient: user.email,
        }),
      });

      const responseData = await response.json().catch(() => ({ error: 'Unknown error' }));

      if (!response.ok) {
        console.error(
          `Failed to send reminders for ${user.email}:`,
          response.status,
          responseData.error || 'Unknown error'
        );
        results.push({
          userId: user._id.toString(),
          email: user.email || '',
          frequency,
          success: false,
          taskCount: allTasks.length,
          error: responseData.error || `HTTP ${response.status}`,
        });
      } else {
        console.log(`Successfully sent ${allTasks.length} task reminders to ${user.email}`);
        results.push({
          userId: user._id.toString(),
          email: user.email || '',
          frequency,
          success: true,
          taskCount: allTasks.length,
        });
      }
    } catch (error) {
      console.error(`Error processing reminders for user ${user.email}:`, error);
      results.push({
        userId: user._id.toString(),
        email: user.email || '',
        frequency,
        success: false,
        taskCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalTasks = results.reduce((sum, r) => sum + r.taskCount, 0);

  console.log(
    `Cron job completed: ${successful} successful, ${failed} failed, ${totalTasks} total tasks sent`
  );

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    dayOfWeek,
    isMonday,
    summary: {
      totalUsers: users.length,
      processed: results.length,
      successful,
      failed,
      totalTasks,
    },
    results,
  });
}

