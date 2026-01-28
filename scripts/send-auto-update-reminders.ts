/**
 * Automated Update Reminder Cron Job
 * 
 * This script sends automated update request emails to agents based on a schedule.
 * Schedule: Day 1, 3, 7, 14, then every 14 days from agent pairing date
 * 
 * Run: npm run send-auto-reminders
 * Cron: Daily at 8:00 AM MT
 */

import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { getAppOrigin } from '@/lib/server/app-origin';
import { logReferralActivity } from '@/lib/server/activities';

// Reminder schedule: days from pairing when reminders should be sent
const REMINDER_SCHEDULE = [1, 3, 7, 14];

// Generate additional bi-weekly reminders (28, 42, 56, 70, 84, ...)
for (let day = 28; day <= 365; day += 14) {
  REMINDER_SCHEDULE.push(day);
}

// Terminal statuses that should not receive reminders
const TERMINAL_STATUSES = ['Closed', 'Lost', 'Terminated'];

interface ReminderResult {
  referralId: string;
  loanFileNumber: string;
  borrowerName: string;
  emailsSent: number;
  daysSincePairing: number;
  status: 'success' | 'skipped' | 'error';
  reason?: string;
}

function shouldSendReminderToday(
  daysSincePairing: number,
  lastSentAt: Date | null
): boolean {
  // Check if today matches a scheduled day
  if (!REMINDER_SCHEDULE.includes(daysSincePairing)) {
    return false;
  }

  // If never sent before, send it
  if (!lastSentAt) {
    return true;
  }

  // Ensure we don't send multiple times on the same day
  const daysSinceLastSent = Math.floor(
    (Date.now() - lastSentAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  
  return daysSinceLastSent >= 1;
}

async function main() {
  console.log('🚀 Starting automated update reminder job...');
  console.log(`⏰ Run time: ${new Date().toISOString()}`);

  if (!isTransactionalEmailConfigured()) {
    console.error('❌ Email service not configured. Exiting.');
    process.exit(1);
  }

  await connectMongo();

  // Query referrals that are eligible for automated reminders
  const referrals = await Referral.find({
    autoUpdateRemindersEnabled: true,
    status: { $nin: TERMINAL_STATUSES },
    deletedAt: null,
    'sla.lastPairedAt': { $exists: true, $ne: null },
    $or: [
      { buySideAgent: { $exists: true, $ne: null } },
      { sellSideAgent: { $exists: true, $ne: null } },
      { assignedAgent: { $exists: true, $ne: null } },
    ],
  })
    .populate('assignedAgent', '_id name email')
    .populate('buySideAgent', '_id name email')
    .populate('sellSideAgent', '_id name email')
    .populate('lender', '_id name email phone')
    .lean();

  console.log(`📊 Found ${referrals.length} referrals with automation enabled`);

  const results: ReminderResult[] = [];
  const now = new Date();

  for (const referral of referrals) {
    const referralId = String(referral._id);
    const result: ReminderResult = {
      referralId,
      loanFileNumber: referral.loanFileNumber || 'N/A',
      borrowerName: referral.borrower?.name || 'Unknown',
      emailsSent: 0,
      daysSincePairing: 0,
      status: 'skipped',
    };

    try {
      // Calculate days since pairing
      if (!referral.sla?.lastPairedAt) {
        result.reason = 'No pairing date';
        results.push(result);
        continue;
      }

      const daysSincePairing = Math.floor(
        (now.getTime() - new Date(referral.sla.lastPairedAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      
      result.daysSincePairing = daysSincePairing;

      // Check if reminder should be sent today
      if (!shouldSendReminderToday(daysSincePairing, referral.lastAutoReminderSentAt)) {
        result.reason = `Not a scheduled day (day ${daysSincePairing})`;
        results.push(result);
        continue;
      }

      // Get unique assigned agents
      const agentMap = new Map<string, any>();
      
      if (referral.assignedAgent && referral.assignedAgent._id) {
        agentMap.set(referral.assignedAgent._id.toString(), referral.assignedAgent);
      }
      if (referral.buySideAgent && referral.buySideAgent._id) {
        agentMap.set(referral.buySideAgent._id.toString(), referral.buySideAgent);
      }
      if (referral.sellSideAgent && referral.sellSideAgent._id) {
        agentMap.set(referral.sellSideAgent._id.toString(), referral.sellSideAgent);
      }

      const agents = Array.from(agentMap.values()).filter((a) => a && a.email);

      if (agents.length === 0) {
        result.reason = 'No agents with email addresses';
        results.push(result);
        continue;
      }

      // Send emails
      const appOrigin = getAppOrigin();
      const referralUrl = `${appOrigin}/referrals/${referralId}`;
      
      // Get lender contact info
      const lender = referral.lender && typeof referral.lender === 'object' ? referral.lender : null;
      const lenderName = lender?.name || 'Not provided';
      const lenderEmail = lender?.email || 'Not provided';
      const lenderPhone = lender?.phone || 'Not provided';

      // Helper to extract first name from full name
      const getFirstName = (fullName: string): string => {
        const [first] = fullName.trim().split(/\s+/);
        return first || fullName;
      };

      const buyerName = referral.borrower?.name || 'Unknown';

      for (const agent of agents) {
        const agentFirstName = getFirstName(agent.name);

        const emailHtml = `
<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:640px;color:#0f172a;line-height:1.6;">
  <h2 style="font-size:20px;margin-bottom:16px;color:#0f172a;">Scheduled Update: ${buyerName}</h2>
  
  <p style="margin:0 0 8px 0;">Hi ${agentFirstName},</p>
  
  <p style="margin:0 0 16px 0;"><strong>Current Status:</strong> ${referral.status}</p>
  
  <p style="margin:0 0 16px 0;">This is an automated reminder to update one of your referrals (Day ${daysSincePairing} since pairing):</p>
  
  <!-- Buyer Info Section -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Buyer Info</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Buyer:</strong> ${buyerName}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> ${referral.borrower?.email || 'Not provided'}</div>
    <div><strong style="color:#64748b;">Phone:</strong> ${referral.borrower?.phone || 'Not provided'}</div>
  </div>
  
  <!-- Mortgage Consultant at AFC Section -->
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
    <h3 style="margin:0 0 12px 0;font-size:16px;font-weight:600;color:#0f172a;">Mortgage Consultant at AFC</h3>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Name:</strong> ${lenderName}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Email:</strong> ${lenderEmail}</div>
    <div style="margin-bottom:8px;"><strong style="color:#64748b;">Phone:</strong> ${lenderPhone}</div>
    <div><strong style="color:#64748b;">File Number:</strong> ${referral.loanFileNumber || 'N/A'}</div>
  </div>
  
  <!-- Agent Relationship Coordinator Section -->
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

Current Status: ${referral.status}

This is an automated reminder to update one of your referrals (Day ${daysSincePairing} since pairing):

Buyer Info
Buyer: ${buyerName}
Email: ${referral.borrower?.email || 'Not provided'}
Phone: ${referral.borrower?.phone || 'Not provided'}

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
          to: [agent.email],
          subject: `Scheduled Update: ${buyerName}`,
          html: emailHtml,
          text: emailText,
        });

        if (delivered) {
          result.emailsSent++;
        }
      }

      // Update timestamp and create audit entry
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

      // Log activity
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
      console.error(`❌ Error processing referral ${referralId}:`, error);
    }

    results.push(result);
  }

  // Print summary
  console.log('\n📋 Summary:');
  console.log(`   Total processed: ${results.length}`);
  console.log(`   ✅ Successful: ${results.filter((r) => r.status === 'success').length}`);
  console.log(`   ⏭️  Skipped: ${results.filter((r) => r.status === 'skipped').length}`);
  console.log(`   ❌ Errors: ${results.filter((r) => r.status === 'error').length}`);
  console.log(`   📧 Total emails sent: ${results.reduce((sum, r) => sum + r.emailsSent, 0)}`);

  // Print details
  const successfulReferrals = results.filter((r) => r.status === 'success');
  if (successfulReferrals.length > 0) {
    console.log('\n✅ Successful sends:');
    for (const result of successfulReferrals) {
      console.log(
        `   • ${result.borrowerName} (${result.loanFileNumber}) - Day ${result.daysSincePairing} - ${result.emailsSent} email(s)`
      );
    }
  }

  const errorReferrals = results.filter((r) => r.status === 'error');
  if (errorReferrals.length > 0) {
    console.log('\n❌ Errors:');
    for (const result of errorReferrals) {
      console.log(
        `   • ${result.borrowerName} (${result.loanFileNumber}): ${result.reason}`
      );
    }
  }

  console.log('\n✅ Job completed successfully');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
