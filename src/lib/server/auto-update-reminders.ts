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
import { getAppOrigin } from '@/lib/server/app-origin';
import { logReferralActivity } from '@/lib/server/activities';
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
        const emailHtml = `
<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:640px;color:#0f172a;line-height:1.6;">
  <p style="margin:0 0 8px 0;">Hi ${agentFirstName},</p>
  <p style="margin:0 0 16px 0;">This is an automated reminder to update one of your referrals (Day ${daysSincePairing} since pairing):</p>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Buyer Info</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Buyer:</strong> ${buyerName}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> ${referral.borrower?.email || 'Not provided'}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Phone:</strong> ${referral.borrower?.phone || 'Not provided'}</div>
    <div><strong style="color:#64748b;">Current Status:</strong> ${referral.status}</div>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Mortgage Consultant at AFC</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Name:</strong> ${lenderName}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> ${lenderEmail}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Phone:</strong> ${lenderPhone}</div>
    <div><strong style="color:#64748b;">File Number:</strong> ${referral.loanFileNumber || 'N/A'}</div>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Agent Relationship Coordinator</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Name:</strong> Kristen Truong</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> kristen.truong@americanhomeagents.com</div>
    <div><strong style="color:#64748b;">Phone:</strong> 303-557-4230</div>
  </div>
  <p style="margin:16px 0;">Please log in to update the status and add any relevant notes:</p>
  <a href="${referralUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;border-radius:8px;background:#0f172a;color:#fff;font-weight:600;text-decoration:none;">View Referral</a>
  <p style="margin:16px 0 8px 0;color:#64748b;font-size:13px;">
    <strong>Automated reminders are enabled for this referral.</strong><br>
    Schedule: Day 1, 3, 7, 14, then every 2 weeks from agent pairing.
  </p>
  <p style="margin:0;color:#64748b;font-size:14px;">Thanks,<br>Referral CRM Team</p>
</div>
        `.trim();

        const emailText = `
Scheduled Update: ${buyerName}

Hi ${agentFirstName},

This is an automated reminder to update one of your referrals (Day ${daysSincePairing} since pairing):

Buyer Info
Buyer: ${buyerName}
Email: ${referral.borrower?.email || 'Not provided'}
Phone: ${referral.borrower?.phone || 'Not provided'}
Current Status: ${referral.status}

Mortgage Consultant at AFC
Name: ${lenderName}
Email: ${lenderEmail}
Phone: ${lenderPhone}
File Number: ${referral.loanFileNumber || 'N/A'}

Agent Relationship Coordinator
Name: Kristen Truong
Email: kristen.truong@americanhomeagents.com
Phone: 303-557-4230

Please log in to update the status and add any relevant notes:
${referralUrl}

Automated reminders are enabled for this referral.
Schedule: Day 1, 3, 7, 14, then every 2 weeks from agent pairing.

Thanks,
Referral CRM Team
        `.trim();

        const delivered = await sendTransactionalEmail({
          to: [agent.email!],
          subject: `Scheduled Update: ${buyerName}`,
          html: emailHtml,
          text: emailText,
        });

        if (delivered) {
          result.emailsSent++;
        }
      }

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
    } catch (error) {
      result.status = 'error';
      result.reason = error instanceof Error ? error.message : 'Unknown error';
    }

    results.push(result);
  }

  return results;
}
