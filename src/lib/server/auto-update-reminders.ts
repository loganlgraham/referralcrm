/**
 * Auto-Update Reminders Helper Functions
 *
 * Utilities for determining when automated update reminders should be enabled by default,
 * and for running the automated update reminder job (used by cron and CLI script).
 */

import { differenceInDays, startOfDay } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';

import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { renderScheduledUpdateReminderEmail } from '@/lib/email-templates/update-request';
import { getAppOrigin } from '@/lib/server/app-origin';
import { logReferralActivity } from '@/lib/server/activities';
import { createAdminNotifications } from '@/lib/server/notifications';
import { getNextAutoUpdateSendAt } from '@/utils/auto-update-schedule';
import { SLA_TIME_ZONE } from '@/utils/sla-insights';

/**
 * Agent-like object with optional ahaDesignation field
 */
interface AgentLike {
  ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
}

/**
 * Referral-like object with optional agent references
 */
interface ReferralLike {
  assignedAgent?: AgentLike | null;
  buySideAgent?: AgentLike | null;
  sellSideAgent?: AgentLike | null;
}

/**
 * Check if a referral has an attached agent with AHA_OOS designation.
 * Checks assignedAgent, buySideAgent, and sellSideAgent.
 *
 * @param referral - Referral object (or similar) with populated agent fields
 * @returns true if any attached agent has ahaDesignation === 'AHA_OOS'
 */
export function hasAhaOosAgentAttached(referral: ReferralLike): boolean {
  return (
    referral.assignedAgent?.ahaDesignation === 'AHA_OOS' ||
    referral.buySideAgent?.ahaDesignation === 'AHA_OOS' ||
    referral.sellSideAgent?.ahaDesignation === 'AHA_OOS'
  );
}

/**
 * Check if a referral has an attached agent with AGIT designation.
 * Checks assignedAgent, buySideAgent, and sellSideAgent.
 *
 * @param referral - Referral object (or similar) with populated agent fields
 * @returns true if any attached agent has ahaDesignation === 'AGIT'
 */
export function hasAgitAgentAttached(referral: ReferralLike): boolean {
  return (
    referral.assignedAgent?.ahaDesignation === 'AGIT' ||
    referral.buySideAgent?.ahaDesignation === 'AGIT' ||
    referral.sellSideAgent?.ahaDesignation === 'AGIT'
  );
}

// Stop cron: referral status Lost or Closed; or any deal status closed/payment_sent/paid.
// Continue cron for Terminated (referral or deal).
const REFERRAL_TERMINAL_STATUSES = ['Closed', 'Lost'];
const DEAL_TERMINAL_STATUSES = ['closed', 'payment_sent', 'paid'];

export interface AutoUpdateReminderResult {
  referralId: string;
  loanFileNumber: string;
  borrowerName: string;
  emailsSent: number;
  daysSincePairing: number;
  status: 'success' | 'skipped' | 'error';
  reason?: string;
}

export interface NoResponseCheckResult {
  referralId: string;
  borrowerName: string;
  status: 'notified' | 'skipped' | 'error';
  reason?: string;
}

export interface RunAutoUpdateRemindersOptions {
  now?: Date;
}

/**
 * Run the automated update reminder job. Sends emails to agents for referrals
 * that are due per the schedule (Day 1, 3, 7, 14, then every 14 days from pairing).
 * Uses Mountain Time for day boundaries to match the cron schedule.
 *
 * Caller must connect to Mongo before calling. Returns a summary of results.
 */
export async function runAutoUpdateReminders(
  options: RunAutoUpdateRemindersOptions = {}
): Promise<AutoUpdateReminderResult[]> {
  const now = options.now ?? new Date();

  if (!isTransactionalEmailConfigured()) {
    throw new Error('Email service not configured');
  }

  // Exclude referrals that have any deal with status closed, payment_sent, or paid
  const referralIdsWithClosedDeal = await Payment.distinct('referralId', {
    status: { $in: DEAL_TERMINAL_STATUSES },
  });

  const referrals = await Referral.find({
    autoUpdateRemindersEnabled: true,
    status: { $nin: REFERRAL_TERMINAL_STATUSES },
    _id: { $nin: referralIdsWithClosedDeal },
    deletedAt: null,
    'sla.lastPairedAt': { $exists: true, $ne: null },
    $or: [
      { buySideAgent: { $exists: true, $ne: null } },
      { sellSideAgent: { $exists: true, $ne: null } },
      { assignedAgent: { $exists: true, $ne: null } },
    ],
  })
    .populate('assignedAgent', '_id name email ahaDesignation')
    .populate('buySideAgent', '_id name email ahaDesignation')
    .populate('sellSideAgent', '_id name email ahaDesignation')
    .populate('lender', '_id name email phone')
    .lean();

  const results: AutoUpdateReminderResult[] = [];

  for (const referral of referrals) {
    const referralId = String(referral._id);
    const result: AutoUpdateReminderResult = {
      referralId,
      loanFileNumber: referral.loanFileNumber || 'N/A',
      borrowerName: referral.borrower?.name || 'Unknown',
      emailsSent: 0,
      daysSincePairing: 0,
      status: 'skipped',
    };

    try {
      // Skip referrals with AGIT-designated agents - no automated emails for AGIT
      if (hasAgitAgentAttached(referral as ReferralLike)) {
        result.reason = 'AGIT agent attached - automated emails disabled';
        results.push(result);
        continue;
      }

      if (!referral.sla?.lastPairedAt) {
        result.reason = 'No pairing date';
        results.push(result);
        continue;
      }

      const pairedAt = new Date(referral.sla.lastPairedAt);
      const zonedNowStart = startOfDay(utcToZonedTime(now, SLA_TIME_ZONE));
      const zonedPairedStart = startOfDay(utcToZonedTime(pairedAt, SLA_TIME_ZONE));
      const daysSincePairing = differenceInDays(zonedNowStart, zonedPairedStart);
      result.daysSincePairing = daysSincePairing;

      const { nextAt } = getNextAutoUpdateSendAt({
        pairedAt: referral.sla.lastPairedAt,
        lastAutoSentAt: referral.lastAutoReminderSentAt,
        autoRemindersEnabled: true,
        status: referral.status ?? 'New Lead',
        now,
      });

      if (!nextAt || nextAt > now) {
        result.reason = nextAt ? `Not yet due (day ${daysSincePairing})` : `Not a scheduled day (day ${daysSincePairing})`;
        results.push(result);
        continue;
      }

      const agentMap = new Map<string, { _id: unknown; name?: string; email?: string }>();
      if (referral.assignedAgent && referral.assignedAgent._id) {
        agentMap.set(String(referral.assignedAgent._id), referral.assignedAgent as { _id: unknown; name?: string; email?: string });
      }
      if (referral.buySideAgent && referral.buySideAgent._id) {
        agentMap.set(String(referral.buySideAgent._id), referral.buySideAgent as { _id: unknown; name?: string; email?: string });
      }
      if (referral.sellSideAgent && referral.sellSideAgent._id) {
        agentMap.set(String(referral.sellSideAgent._id), referral.sellSideAgent as { _id: unknown; name?: string; email?: string });
      }

      const agents = Array.from(agentMap.values()).filter((a) => a && a.email);

      if (agents.length === 0) {
        result.reason = 'No agents with email addresses';
        results.push(result);
        continue;
      }

      const appOrigin = getAppOrigin();
      const referralUrl = `${appOrigin}/referrals/${referralId}`;
      const lender = referral.lender && typeof referral.lender === 'object' ? referral.lender : null;
      const lenderName = lender?.name || 'Not provided';
      const lenderEmail = lender?.email || 'Not provided';
      const lenderPhone = lender?.phone || 'Not provided';
      const buyerName = referral.borrower?.name || 'Unknown';

      const getFirstName = (fullName: string): string => {
        const [first] = fullName.trim().split(/\s+/);
        return first || fullName;
      };

      for (const agent of agents) {
        const agentFirstName = getFirstName(agent.name ?? '');
        const { html, text } = renderScheduledUpdateReminderEmail({
          agentFirstName,
          buyerName,
          daysSincePairing,
          referralUrl,
          contacts: {
            buyerName,
            buyerEmail: referral.borrower?.email || 'Not provided',
            buyerPhone: referral.borrower?.phone || 'Not provided',
            status: referral.status,
            lenderName,
            lenderEmail,
            lenderPhone,
            loanFileNumber: referral.loanFileNumber || 'N/A',
          },
        });

        const delivered = await sendTransactionalEmail({
          to: [agent.email!],
          subject: `Scheduled Update: ${buyerName}`,
          html,
          text,
        });

        if (delivered) {
          result.emailsSent++;
        }
      }

      // Only advance the reminder cursor if at least one email actually
      // delivered. Advancing on zero-sent batches silently skips the next
      // scheduled day when Resend/email is transiently broken.
      if (result.emailsSent > 0) {
        await Referral.findByIdAndUpdate(referralId, {
          $set: { lastAutoReminderSentAt: now },
          $push: {
            audit: {
              actorId: null,
              actorRole: 'system',
              field: 'auto_update_reminder',
              previousValue: null,
              newValue: agents.map((a) => a._id),
              timestamp: now,
            },
          },
        });

        const agentNames = agents.map((a) => a.name).join(', ');
        await logReferralActivity({
          referralId,
          actorRole: 'system',
          actorId: null,
          channel: 'email',
          content: `Automated update reminder sent to ${agentNames} (Day ${daysSincePairing})`,
        });

        result.status = 'success';
        result.reason = `Sent to ${result.emailsSent} agent(s)`;
      } else {
        result.status = 'error';
        result.reason = `Email delivery failed for all ${agents.length} agent(s); will retry on next run`;
        console.error(
          `[AutoUpdateReminders] No emails delivered for referral ${referralId}; cursor not advanced so the next cron run can retry.`
        );
      }
    } catch (error) {
      result.status = 'error';
      result.reason = error instanceof Error ? error.message : 'Unknown error';
    }

    results.push(result);
  }

  return results;
}

/**
 * Check for referrals where an update request email was sent 24+ hours ago
 * and the agent has not responded (no note, status change, or contact action).
 *
 * Creates an admin notification for each such referral, at most once per
 * reminder cycle (deduplicated via lastNoResponse24hNotifiedAt).
 *
 * Caller must connect to Mongo before calling.
 */
export async function runNoResponseChecks(
  options: RunAutoUpdateRemindersOptions = {}
): Promise<NoResponseCheckResult[]> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
  const epoch = new Date(0);

  // Exclude referrals with closed deals (same as runAutoUpdateReminders)
  const referralIdsWithClosedDeal = await Payment.distinct('referralId', {
    status: { $in: DEAL_TERMINAL_STATUSES },
  });

  const referrals = await Referral.find({
    autoUpdateRemindersEnabled: true,
    status: { $nin: REFERRAL_TERMINAL_STATUSES },
    _id: { $nin: referralIdsWithClosedDeal },
    deletedAt: null,
    // Latest update request (auto or manual) was sent more than 24h ago,
    // and agent has NOT responded since that request.
    $expr: {
      $let: {
        vars: {
          latestRequestAt: {
            $max: [
              { $ifNull: ['$lastAutoReminderSentAt', epoch] },
              { $ifNull: ['$lastManualReminderSentAt', epoch] },
            ],
          },
        },
        in: {
          $and: [
            { $gt: ['$$latestRequestAt', epoch] },
            { $lte: ['$$latestRequestAt', cutoff] },
            {
              $or: [
                { $eq: ['$lastUpdateRequestResponseNotifiedAt', null] },
                { $lt: ['$lastUpdateRequestResponseNotifiedAt', '$$latestRequestAt'] },
              ],
            },
          ],
        },
      },
    },
  })
    .select('_id borrower.name lastAutoReminderSentAt lastManualReminderSentAt lastNoResponse24hNotifiedAt')
    .lean();

  const results: NoResponseCheckResult[] = [];

  for (const referral of referrals) {
    const referralId = String(referral._id);
    const borrowerName = referral.borrower?.name || 'Unknown';

    try {
      // Dedup: skip if we already notified for this reminder cycle
      const lastNotifiedTime = referral.lastNoResponse24hNotifiedAt
        ? new Date(referral.lastNoResponse24hNotifiedAt).getTime()
        : 0;
      const lastReminderTime = Math.max(
        referral.lastAutoReminderSentAt ? new Date(referral.lastAutoReminderSentAt).getTime() : 0,
        referral.lastManualReminderSentAt ? new Date(referral.lastManualReminderSentAt).getTime() : 0
      );

      if (lastNotifiedTime >= lastReminderTime) {
        results.push({
          referralId,
          borrowerName,
          status: 'skipped',
          reason: 'Already notified for this reminder cycle',
        });
        continue;
      }

      await createAdminNotifications({
        type: 'checkin_no_response_24h',
        referralId,
        borrowerName,
        actorRole: 'system',
        actorName: 'System',
        content: `Agent has not responded to update request for ${borrowerName} (24+ hours)`,
      });

      await Referral.findByIdAndUpdate(referralId, {
        $set: { lastNoResponse24hNotifiedAt: now },
      });

      results.push({
        referralId,
        borrowerName,
        status: 'notified',
      });
    } catch (error) {
      results.push({
        referralId,
        borrowerName,
        status: 'error',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return results;
}
