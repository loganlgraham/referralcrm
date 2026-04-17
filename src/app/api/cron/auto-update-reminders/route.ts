import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { runAutoUpdateReminders, runNoResponseChecks } from '@/lib/server/auto-update-reminders';

export const runtime = 'nodejs';

/**
 * Cron job that runs daily at 8:00 AM MT to send automated update request emails
 * to agents for referrals on the schedule (Day 1, 3, 7, 14, then every 14 days).
 * Triggered by Vercel Cron.
 *
 * Schedule: 0 15 * * * (15:00 UTC = 8:00 AM MST)
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret) {
    console.error('CRON_SECRET environment variable is not set');
    return NextResponse.json({ error: 'Cron job not configured' }, { status: 503 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  console.log(`[Auto-Update Reminders] Running cron job at ${now.toISOString()}`);

  try {
    await connectMongo();

    const results = await runAutoUpdateReminders({ now });

    const successful = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const totalEmails = results.reduce((sum, r) => sum + r.emailsSent, 0);

    console.log(
      `[Auto-Update Reminders] Completed: ${successful} sent, ${skipped} skipped, ${failed} errors, ${totalEmails} emails`
    );

    // Check for agents who haven't responded to update requests in 24+ hours
    const noResponseResults = await runNoResponseChecks({ now });
    const noResponseNotified = noResponseResults.filter((r) => r.status === 'notified').length;
    const noResponseErrors = noResponseResults.filter((r) => r.status === 'error').length;

    console.log(
      `[No-Response Checks] Completed: ${noResponseNotified} notified, ${noResponseResults.length - noResponseNotified - noResponseErrors} skipped, ${noResponseErrors} errors`
    );

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      summary: {
        processed: results.length,
        successful,
        skipped,
        failed,
        emailsSent: totalEmails,
        noResponseNotified,
        noResponseErrors,
      },
      results,
      noResponseResults,
    });
  } catch (error) {
    console.error('[Auto-Update Reminders] Cron job error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
