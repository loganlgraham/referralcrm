import { NextRequest, NextResponse } from 'next/server';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { Payment } from '@/models/payment';
import { getAppOrigin } from '@/lib/server/app-origin';

export const runtime = 'nodejs';

const SEND_DELAY_MS = 1000;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 2000;
const SLA_TIME_ZONE = 'America/Denver';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ReminderResult {
  paymentId: string;
  closingDate: string;
  success: boolean;
  error?: string;
}

interface PaymentLean {
  _id: Types.ObjectId;
  closingDate?: Date | null;
  status?: string | null;
  agentId?: Types.ObjectId | null;
  contractPriceCents?: number | null;
}

/**
 * Cron job that runs daily to send fee breakdown emails for deals closing in 7 days
 * Triggered by Vercel Cron
 */
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

  const now = new Date();

  // Compute the 7-days-out window in America/Denver so payments closing on the
  // correct Denver calendar day are picked up regardless of when the cron fires
  // in UTC. Without this the bounds drift by ~7h across the DST boundary and
  // can exclude/duplicate payments near midnight MT.
  const zonedNow = utcToZonedTime(now, SLA_TIME_ZONE);
  const zonedTargetStart = startOfDay(addDays(zonedNow, 7));
  const zonedTargetEnd = endOfDay(addDays(zonedNow, 7));
  const targetDateStart = zonedTimeToUtc(zonedTargetStart, SLA_TIME_ZONE);
  const targetDateEnd = zonedTimeToUtc(zonedTargetEnd, SLA_TIME_ZONE);

  console.log(`[Closing Reminders] Running cron job at ${now.toISOString()}`);
  console.log(`[Closing Reminders] Looking for deals closing on ${targetDateStart.toISOString()} to ${targetDateEnd.toISOString()} (Denver day)`);

  try {
    // connectMongo is inside the try so connection failures produce the
    // structured JSON error shape, not an unhandled rejection.
    await connectMongo();

    // Exclude deals with AHA- or AGIT-designated agents (only AHA_OOS and others get auto-send)
    const ahaAgents = await Agent.find({ ahaDesignation: { $in: ['AHA', 'AGIT'] } })
      .select('_id')
      .lean();
    const ahaAgentIds = ahaAgents.map((a) => a._id);
    if (ahaAgentIds.length > 0) {
      console.log(`[Closing Reminders] Excluding ${ahaAgentIds.length} AHA/AGIT-designated agents from auto-send`);
    }

    // Query for payments that:
    // 1. Have a closing date 7 days from now
    // 2. Are not terminated
    // 3. Have not already been sent a fee breakdown email
    // 4. Have an agent assigned (excluding AHA-designated agents)
    const agentIdFilter: Record<string, unknown> = {
      $ne: null,
      $exists: true,
    };
    if (ahaAgentIds.length > 0) {
      agentIdFilter.$nin = ahaAgentIds;
    }

    const payments = await Payment.find({
      closingDate: {
        $gte: targetDateStart,
        $lte: targetDateEnd,
      },
      status: { $ne: 'terminated' },
      feeBreakdownEmailSentAt: null,
      agentId: agentIdFilter,
      contractPriceCents: { $ne: null, $gt: 0 },
      $or: [
        { commissionBasisPoints: { $ne: null, $gt: 0 } },
        { commissionFlatFeeCents: { $ne: null, $gt: 0 } },
      ],
      referralFeeBasisPoints: { $ne: null, $gt: 0 },
    })
      .select('_id closingDate status agentId contractPriceCents')
      .lean<PaymentLean[]>();

    console.log(`[Closing Reminders] Found ${payments.length} deals requiring fee breakdown emails`);

    if (payments.length === 0) {
      return NextResponse.json({
        success: true,
        timestamp: now.toISOString(),
        message: 'No deals found requiring fee breakdown emails',
        processed: 0,
        successful: 0,
        failed: 0,
      });
    }

    const results: ReminderResult[] = [];
    const baseUrl = getAppOrigin(request);

    for (let i = 0; i < payments.length; i++) {
      if (i > 0) await delay(SEND_DELAY_MS);

      const payment = payments[i];
      const paymentId = (payment._id as Types.ObjectId).toString();
      const apiUrl = `${baseUrl}/api/payments/${paymentId}/send-fee-breakdown`;

      let lastError = '';
      let succeeded = false;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const backoff = RETRY_BASE_MS * Math.pow(2, attempt - 1);
          console.log(`[Closing Reminders] Retry ${attempt}/${MAX_RETRIES} for payment ${paymentId} after ${backoff}ms`);
          await delay(backoff);
        } else {
          console.log(`[Closing Reminders] Sending fee breakdown for payment ${paymentId}`);
        }

        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${cronSecret}`,
            },
          });

          if (response.ok) {
            console.log(`[Closing Reminders] Successfully sent fee breakdown for payment ${paymentId}`);
            succeeded = true;
            break;
          }

          let responseData: { error?: string; [key: string]: unknown } = { error: 'Unknown error' };
          const responseText = await response.text().catch(() => '');
          if (responseText) {
            try {
              responseData = JSON.parse(responseText);
            } catch {
              responseData = { error: `Non-JSON response (${response.status})`, rawBody: responseText.substring(0, 200) };
            }
          }

          lastError = responseData.error || `HTTP ${response.status}`;

          if (response.status === 429 && attempt < MAX_RETRIES) {
            continue;
          }

          console.error(
            `[Closing Reminders] Failed to send fee breakdown for payment ${paymentId}:`,
            response.status,
            lastError
          );
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : 'Unknown error';
          if (attempt < MAX_RETRIES) continue;
          console.error(`[Closing Reminders] Error processing payment ${paymentId}:`, error);
          break;
        }
      }

      results.push({
        paymentId,
        closingDate: payment.closingDate?.toISOString() || 'unknown',
        success: succeeded,
        error: succeeded ? undefined : lastError,
      });
    }

    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(
      `[Closing Reminders] Cron job completed: ${successful} successful, ${failed} failed`
    );

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      targetDate: targetDateStart.toISOString(),
      summary: {
        processed: results.length,
        successful,
        failed,
      },
      results,
    });
  } catch (error) {
    console.error('[Closing Reminders] Cron job error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
