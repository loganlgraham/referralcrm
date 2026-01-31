/**
 * Automated Update Reminder Cron Job
 *
 * This script sends automated update request emails to agents based on a schedule.
 * Schedule: Day 1, 3, 7, 14, then every 14 days from agent pairing date
 *
 * Run: npm run send-auto-reminders
 * Cron: Daily at 8:00 AM MT (Vercel Cron: /api/cron/auto-update-reminders)
 */

import { connectMongo } from '@/lib/mongoose';
import { runAutoUpdateReminders } from '@/lib/server/auto-update-reminders';

async function main() {
  console.log('🚀 Starting automated update reminder job...');
  console.log(`⏰ Run time: ${new Date().toISOString()}`);

  await connectMongo();

  const results = await runAutoUpdateReminders();

  console.log(`📊 Found ${results.length} referrals with automation enabled`);

  console.log('\n📋 Summary:');
  console.log(`   Total processed: ${results.length}`);
  console.log(`   ✅ Successful: ${results.filter((r) => r.status === 'success').length}`);
  console.log(`   ⏭️  Skipped: ${results.filter((r) => r.status === 'skipped').length}`);
  console.log(`   ❌ Errors: ${results.filter((r) => r.status === 'error').length}`);
  console.log(`   📧 Total emails sent: ${results.reduce((sum, r) => sum + r.emailsSent, 0)}`);

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
