import { NextRequest, NextResponse } from 'next/server';
import { addDays, startOfDay, endOfDay } from 'date-fns';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';

export const runtime = 'nodejs';

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

  await connectMongo();

  const now = new Date();
  const sevenDaysFromNow = addDays(now, 7);
  
  // Get start and end of the day 7 days from now (to catch all deals closing on that date)
  const targetDateStart = startOfDay(sevenDaysFromNow);
  const targetDateEnd = endOfDay(sevenDaysFromNow);

  console.log(`[Closing Reminders] Running cron job at ${now.toISOString()}`);
  console.log(`[Closing Reminders] Looking for deals closing on ${targetDateStart.toISOString()} to ${targetDateEnd.toISOString()}`);

  try {
    // Query for payments that:
    // 1. Have a closing date 7 days from now
    // 2. Are not terminated
    // 3. Have not already been sent a fee breakdown email
    // 4. Have an agent assigned
    const payments = await Payment.find({
      closingDate: {
        $gte: targetDateStart,
        $lte: targetDateEnd,
      },
      status: { $ne: 'terminated' },
      feeBreakdownEmailSentAt: null,
      agentId: { $ne: null, $exists: true },
      contractPriceCents: { $ne: null, $gt: 0 },
      commissionBasisPoints: { $ne: null, $gt: 0 },
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

    // Process each payment
    for (const payment of payments) {
      const paymentId = (payment._id as Types.ObjectId).toString();
      
      try {
        console.log(`[Closing Reminders] Sending fee breakdown for payment ${paymentId}`);
        
        // Call the fee breakdown API
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : new URL(request.url).origin;
        const apiUrl = `${baseUrl}/api/payments/${paymentId}/send-fee-breakdown`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cronSecret}`,
          },
        });

        const responseData = await response.json().catch(() => ({ error: 'Unknown error' }));

        if (!response.ok) {
          console.error(
            `[Closing Reminders] Failed to send fee breakdown for payment ${paymentId}:`,
            response.status,
            responseData.error || 'Unknown error'
          );
          results.push({
            paymentId,
            closingDate: payment.closingDate?.toISOString() || 'unknown',
            success: false,
            error: responseData.error || `HTTP ${response.status}`,
          });
        } else {
          console.log(`[Closing Reminders] Successfully sent fee breakdown for payment ${paymentId}`);
          results.push({
            paymentId,
            closingDate: payment.closingDate?.toISOString() || 'unknown',
            success: true,
          });
        }
      } catch (error) {
        console.error(`[Closing Reminders] Error processing payment ${paymentId}:`, error);
        results.push({
          paymentId,
          closingDate: payment.closingDate?.toISOString() || 'unknown',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
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
