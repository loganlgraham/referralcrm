import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { verifyPaymentActionToken, getReferralAppBaseUrl } from '@/lib/referral-links';
import { logReferralActivity } from '@/lib/server/activities';

interface Params {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  const hasValidToken = verifyPaymentActionToken(params.id, token);
  
  if (!hasValidToken) {
    return new NextResponse('Unauthorized - Invalid token', { status: 401 });
  }

  await connectMongo();
  const payment = await Payment.findById(params.id);
  
  if (!payment) {
    return new NextResponse('Payment not found', { status: 404 });
  }

  // Don't allow if already paid or payment_sent
  if (payment.status === 'paid' || payment.status === 'payment_sent') {
    const baseUrl = getReferralAppBaseUrl();
    const referralLink = baseUrl ? `${baseUrl}/referrals/${payment.referralId.toString()}` : null;
    
    if (referralLink) {
      return NextResponse.redirect(`${referralLink}?payment-already-marked=true`);
    }
    return NextResponse.json({ 
      success: true, 
      message: 'Payment already marked as sent or paid',
      status: payment.status 
    });
  }

  // Only allow if status is 'closed'
  if (payment.status !== 'closed') {
    return new NextResponse('Payment must be closed before marking as payment sent', { status: 400 });
  }

  const referral = await Referral.findById(payment.referralId).populate('assignedAgent', 'name email userId');
  if (!referral) {
    return new NextResponse('Referral not found', { status: 404 });
  }

  const previousStatus = payment.status;
  payment.status = 'payment_sent';
  
  // Update payment timestamp
  const now = new Date();
  payment.updatedAt = now;

  await payment.save();

  // Log activity
  const agentName = referral.assignedAgent && typeof referral.assignedAgent === 'object'
    ? referral.assignedAgent.name || 'Agent'
    : 'Agent';
  const borrowerName = referral.borrower?.name || 'the borrower';

  const agentId = referral.assignedAgent && typeof referral.assignedAgent === 'object'
    ? (referral.assignedAgent.userId ?? referral.assignedAgent._id ?? null)
    : null;

  await logReferralActivity({
    referralId: referral._id,
    actorRole: 'agent',
    actorId: agentId,
    channel: 'update',
    content: `${agentName} marked the payment as Payment Sent via quick link.`,
  });

  const baseUrl = getReferralAppBaseUrl();
  const referralLink = baseUrl ? `${baseUrl}/referrals/${referral._id.toString()}?payment-marked-sent=true` : null;

  if (referralLink) {
    return NextResponse.redirect(referralLink);
  }

  return NextResponse.json({ 
    success: true, 
    message: 'Payment marked as sent',
    status: payment.status 
  });
}
