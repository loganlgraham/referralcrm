import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { generateFeeBreakdownEmailHTML } from '@/lib/email-templates/fee-breakdown';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';

interface PaymentLean {
  _id: Types.ObjectId;
  closingDate?: Date | null;
  agentId?: Types.ObjectId | { _id: Types.ObjectId; name?: string | null; email?: string | null } | null;
  referralId?: Types.ObjectId | { _id: Types.ObjectId; borrower?: { name?: string | null } | null; propertyAddress?: string | null; loanFileNumber?: string | null } | null;
  contractPriceCents?: number | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  side?: 'buy' | 'sell' | null;
  usedAfc?: boolean | null;
  propertyAddress?: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  await connectMongo();

  const paymentId = params.id;

  // Validate payment ID
  if (!paymentId || !Types.ObjectId.isValid(paymentId)) {
    return NextResponse.json({ error: 'Invalid payment ID' }, { status: 400 });
  }

  // Check authentication - either session or CRON_SECRET
  const session = await getCurrentSession();
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCronRequest = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!session && !isCronRequest) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify admin role for manual sends
  if (session && session.user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
  }

  // Check if email is configured
  if (!isTransactionalEmailConfigured()) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  try {
    // Fetch payment with related data
    const payment = await Payment.findById(paymentId)
      .populate('referralId')
      .populate('agentId')
      .lean<PaymentLean>();

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    // Validate payment has required data
    if (!payment.closingDate) {
      return NextResponse.json({ error: 'Payment has no closing date' }, { status: 400 });
    }

    if (!payment.agentId) {
      return NextResponse.json({ error: 'Payment has no agent assigned' }, { status: 400 });
    }

    if (!payment.contractPriceCents || !payment.commissionBasisPoints || !payment.referralFeeBasisPoints) {
      return NextResponse.json({ error: 'Payment missing required financial data' }, { status: 400 });
    }

    // Get agent email - agentId is populated, so it's an object
    const agent = payment.agentId as { _id: Types.ObjectId; name?: string | null; email?: string | null } | null;
    if (!agent || !agent.email) {
      return NextResponse.json({ error: 'Agent email not found' }, { status: 400 });
    }

    // Get referral data - referralId is populated, so it's an object
    const referral = payment.referralId as { _id: Types.ObjectId; borrower?: { name?: string | null } | null; propertyAddress?: string | null; loanFileNumber?: string | null } | null;
    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    // Build platform URL
    const origin = process.env.NEXT_PUBLIC_APP_URL || 
                   (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const platformUrl = `${origin}/referrals/${(referral._id as Types.ObjectId).toString()}`;

    // Generate email content
    const { html, text } = generateFeeBreakdownEmailHTML({
      agent: {
        name: agent.name || 'Agent',
        email: agent.email,
      },
      referral: {
        borrowerName: referral.borrower?.name || 'Unknown',
        propertyAddress: payment.propertyAddress || referral.propertyAddress || 'Address not available',
        loanFileNumber: referral.loanFileNumber || null,
      },
      deal: {
        closingDate: payment.closingDate.toISOString(),
        contractPriceCents: payment.contractPriceCents,
        commissionBasisPoints: payment.commissionBasisPoints,
        referralFeeBasisPoints: payment.referralFeeBasisPoints,
        side: payment.side || 'buy',
        usedAfc: Boolean(payment.usedAfc),
      },
      platformUrl,
    });

    // Send email
    const emailSent = await sendTransactionalEmail({
      to: [agent.email],
      cc: ['kristen.truong@americanhomeagents.com'],
      subject: 'Referral Fee Breakdown - Closing in 7 Days',
      html,
      text,
    });

    if (!emailSent) {
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }

    // Update payment record
    const actorId = isCronRequest ? 'cron' : (session?.user?.id || 'system');
    await Payment.findByIdAndUpdate(paymentId, {
      feeBreakdownEmailSentAt: new Date(),
      feeBreakdownEmailSentBy: actorId,
    });

    // Log activity
    try {
      const auditActorId = isCronRequest ? null : await resolveAuditActorId(session?.user?.id);
      const sentBy = isCronRequest ? 'automated system' : 'admin';
      await logReferralActivity({
        referralId: (referral._id as Types.ObjectId).toString(),
        actorId: auditActorId,
        actorRole: isCronRequest ? 'system' : (session?.user?.role || 'system'),
        channel: 'email',
        content: `Fee breakdown email sent to ${agent.email} (${sentBy}) for deal closing ${payment.closingDate.toISOString().split('T')[0]}`,
      });
    } catch (error) {
      // Log error but don't fail the request
      console.error('Failed to log activity:', error);
    }

    return NextResponse.json({ 
      success: true,
      message: 'Fee breakdown email sent successfully',
      sentTo: agent.email,
    });
  } catch (error) {
    console.error('Error sending fee breakdown email:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
