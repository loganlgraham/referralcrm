import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { addDays } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { generateFeeBreakdownEmailHTML, generateFeeBreakdownSubject } from '@/lib/email-templates/fee-breakdown';
import { buildReferralLink, getReferralAppBaseUrl } from '@/lib/referral-links';
import { FEE_VERIFICATION_TTL_DAYS, hasFeeBreakdownFinancialData } from '@/lib/fee-verification';
import { FeeBreakdownVerification } from '@/models/fee-breakdown-verification';
import { buildCcList, getReferralNotificationRecipients } from '@/lib/server/cc-recipients';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';
import {
  FeeBreakdownDocumentError,
  loadFeeBreakdownAttachments,
  type FeeBreakdownAttachment,
} from '@/lib/server/fee-breakdown-documents';

interface PaymentLean {
  _id: Types.ObjectId;
  closingDate?: Date | null;
  agentId?: Types.ObjectId | { _id: Types.ObjectId; name?: string | null; email?: string | null } | null;
  referralId?: Types.ObjectId | { _id: Types.ObjectId; borrower?: { name?: string | null } | null; propertyAddress?: string | null; loanFileNumber?: string | null } | null;
  contractPriceCents?: number | null;
  commissionBasisPoints?: number | null;
  commissionFlatFeeCents?: number | null;
  referralFeeBasisPoints?: number | null;
  side?: 'buy' | 'sell' | null;
  usedAfc?: boolean | null;
  propertyAddress?: string | null;
  propertyCity?: string | null;
  propertyState?: string | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  const isCronRequest = cronSecret && authHeader === `Bearer ${cronSecret}`;

  const session = isCronRequest ? null : await getCurrentSession();

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

  let additionalCcRecipients: string[] = [];
  const requestBody = await request.json().catch(() => null);
  if (requestBody && typeof requestBody === 'object') {
    const body = requestBody as { additionalCc?: unknown; additionalCcRecipients?: unknown };
    const candidates: unknown[] = [];

    if (body.additionalCc != null) {
      candidates.push(body.additionalCc);
    }

    if (body.additionalCcRecipients != null) {
      if (!Array.isArray(body.additionalCcRecipients)) {
        return NextResponse.json({ error: 'Additional CC recipients must be an array of strings' }, { status: 400 });
      }
      candidates.push(...body.additionalCcRecipients);
    }

    const normalizedRecipients: string[] = [];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') {
        return NextResponse.json({ error: 'Additional CC values must be strings' }, { status: 400 });
      }
      const normalized = candidate.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      if (!EMAIL_REGEX.test(normalized)) {
        return NextResponse.json({ error: `Additional CC email is invalid: ${normalized}` }, { status: 400 });
      }
      normalizedRecipients.push(normalized);
    }

    additionalCcRecipients = Array.from(new Set(normalizedRecipients));
  }

  try {
    // Fetch payment with related data
    const payment = await Payment.findById(paymentId)
      .populate('referralId')
      .populate('agentId', '_id name email ahaDesignation')
      .lean<PaymentLean & { feeBreakdownEmailSentAt?: Date | null; feeReminderClosingDate?: Date | null }>();

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    // Cron is idempotent: if the payment has already been claimed, short-circuit
    // without calling Resend. Manual admin sends still bypass this so admins can
    // resend at will.
    if (isCronRequest && payment.feeReminderClosingDate && payment.feeReminderClosingDate.getTime() === payment.closingDate?.getTime()) {
      return NextResponse.json({
        success: true,
        alreadySent: true,
        message: 'Fee breakdown was already sent; skipping duplicate send',
      });
    }

    // Validate payment has required data
    if (!payment.closingDate) {
      return NextResponse.json({ error: 'Payment has no closing date' }, { status: 400 });
    }

    if (!payment.agentId) {
      return NextResponse.json({ error: 'Payment has no agent assigned' }, { status: 400 });
    }

    if (!hasFeeBreakdownFinancialData(payment)) {
      return NextResponse.json({ error: 'Payment missing required financial data' }, { status: 400 });
    }

    // Get agent email - agentId is populated, so it's an object
    const agent = payment.agentId as { _id: Types.ObjectId; name?: string | null; email?: string | null; ahaDesignation?: string | null } | null;
    const agentEmail = agent?.email?.trim();
    if (!agent || !agentEmail) {
      return NextResponse.json({ error: 'Agent email not found' }, { status: 400 });
    }

    // Block fee breakdown emails for AGIT agents always; block AHA agents only for auto-send (cron)
    if (agent.ahaDesignation === 'AGIT' || (isCronRequest && agent.ahaDesignation === 'AHA')) {
      return NextResponse.json(
        { error: 'Fee breakdown emails are not sent to AGIT designated agents, and AHA agents are excluded from auto-send' },
        { status: 400 }
      );
    }

    // Get referral data - referralId is populated, so it's an object
    const referral = payment.referralId as { _id: Types.ObjectId; borrower?: { name?: string | null } | null; propertyAddress?: string | null; propertyCity?: string | null; propertyState?: string | null; loanFileNumber?: string | null } | null;
    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    const platformUrl = buildReferralLink((referral._id as Types.ObjectId).toString());

    // Get borrower name for subject line
    const borrowerName = referral.borrower?.name || 'Unknown';
    const isFirstSend = !isCronRequest && !payment.feeBreakdownEmailSentAt;
    const propertyAddress = payment.propertyAddress || referral.propertyAddress || 'Address not available';

    const verificationToken = randomBytes(32).toString('hex');
    const verifyBaseUrl = `${getReferralAppBaseUrl()}/verify-fee?token=${verificationToken}`;

    // Generate email content
    const { html, text } = generateFeeBreakdownEmailHTML({
      agent: {
        name: agent.name || 'Agent',
        email: agentEmail,
      },
      referral: {
        borrowerName,
        propertyAddress,
        propertyCity: payment.propertyCity || referral.propertyCity || null,
        propertyState: payment.propertyState || referral.propertyState || null,
        loanFileNumber: referral.loanFileNumber || null,
      },
      deal: {
        closingDate: payment.closingDate.toISOString(),
        contractPriceCents: payment.contractPriceCents,
        commissionBasisPoints: payment.commissionBasisPoints ?? null,
        commissionFlatFeeCents: payment.commissionFlatFeeCents ?? null,
        referralFeeBasisPoints: payment.referralFeeBasisPoints,
        side: payment.side || 'buy',
        usedAfc: Boolean(payment.usedAfc),
      },
      platformUrl,
      isFirstSend,
      verification: {
        confirmUrl: `${verifyBaseUrl}&action=confirm`,
        reportUrl: `${verifyBaseUrl}&action=report`,
      },
    });

    const subject = generateFeeBreakdownSubject(borrowerName, { isFirstSend });
    const ccRecipients = buildCcList(
      getReferralNotificationRecipients(),
      additionalCcRecipients.filter((email): email is string => Boolean(email)),
      agentEmail
    );

    let attachments: FeeBreakdownAttachment[];
    try {
      attachments = await loadFeeBreakdownAttachments();
    } catch (error) {
      const details = error instanceof Error ? error.message : 'Unknown attachment error';
      console.error('[Fee Breakdown] Attachments unavailable:', details);
      return NextResponse.json(
        {
          error: 'Fee breakdown attachments unavailable',
          details: error instanceof FeeBreakdownDocumentError ? details : 'Unable to load fee breakdown attachments',
        },
        { status: 503 }
      );
    }

    const actorId = isCronRequest ? 'cron' : (session?.user?.id || 'system');
    const claimedAt = new Date();

    // For cron sends, atomically "claim" the payment before calling Resend.
    // This prevents duplicate sends if two cron workers race or the outer
    // route retries after a transient failure. A missed claim means another
    // worker already won; we treat that as already-sent.
    if (isCronRequest) {
      const claim = await Payment.findOneAndUpdate(
        { _id: paymentId, closingDate: payment.closingDate, feeReminderClosingDate: { $ne: payment.closingDate }, status: { $in: ['under_contract', 'past_inspection', 'past_appraisal', 'clear_to_close'] } },
        {
          $set: {
            feeReminderClosingDate: payment.closingDate,
          },
        }
      );
      if (!claim) {
        return NextResponse.json({
          success: true,
          alreadySent: true,
          message: 'Fee breakdown was claimed by another worker; skipping duplicate send',
        });
      }
    }

    let emailSent = false;
    let sendError: unknown = null;
    let verificationId: Types.ObjectId | null = null;
    try {
      const verification = await FeeBreakdownVerification.create({
        token: verificationToken,
        paymentId: payment._id,
        referralId: referral._id,
        agentId: agent._id,
        recipientEmail: agentEmail,
        recipientName: agent.name || null,
        borrowerName,
        propertyAddress,
        snapshot: {
          contractPriceCents: payment.contractPriceCents,
          commissionBasisPoints: payment.commissionBasisPoints ?? null,
          commissionFlatFeeCents: payment.commissionFlatFeeCents ?? null,
          referralFeeBasisPoints: payment.referralFeeBasisPoints,
          closingDate: payment.closingDate,
        },
        expiresAt: addDays(claimedAt, FEE_VERIFICATION_TTL_DAYS),
      });
      verificationId = verification._id as Types.ObjectId;

      emailSent = await sendTransactionalEmail({
        to: [agentEmail],
        cc: ccRecipients,
        subject,
        html,
        text,
        attachments,
        context: { referralId: referral._id.toString() },
      });
    } catch (err) {
      sendError = err;
    }

    if (!emailSent) {
      if (verificationId) {
        await FeeBreakdownVerification.deleteOne({ _id: verificationId }).catch((cleanupErr) => {
          console.error('[Fee Breakdown] Failed to remove unsent verification token:', cleanupErr);
        });
      }
      // Roll back the cron claim so the next run can retry this payment.
      if (isCronRequest) {
        await Payment.updateOne(
          { _id: paymentId, feeReminderClosingDate: payment.closingDate },
          { $unset: { feeReminderClosingDate: 1 } }
        ).catch((rollbackErr) => {
          console.error('[Fee Breakdown] Failed to roll back claim after send error:', rollbackErr);
        });
      }
      if (sendError) {
        console.error('[Fee Breakdown] sendTransactionalEmail threw:', sendError);
      }
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 });
    }

    // Manual sends commit the timestamp only on delivery success.
    await Payment.findByIdAndUpdate(paymentId, {
      feeBreakdownEmailSentAt: claimedAt,
      feeBreakdownEmailSentBy: actorId,
      feeBreakdownVerificationStatus: 'pending',
      feeBreakdownVerifiedAt: null,
    });

    await FeeBreakdownVerification.updateMany(
      { paymentId: payment._id, _id: { $ne: verificationId }, status: { $ne: 'superseded' } },
      { $set: { status: 'superseded' } }
    ).catch((supersedeErr) => {
      console.error('[Fee Breakdown] Failed to supersede older verification links:', supersedeErr);
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
        content: `Fee breakdown email sent to ${agentEmail} (${sentBy}) for deal closing ${payment.closingDate.toISOString().split('T')[0]}`,
      });
    } catch (error) {
      // Log error but don't fail the request
      console.error('Failed to log activity:', error);
    }

    return NextResponse.json({ 
      success: true,
      message: 'Fee breakdown email sent successfully',
      sentTo: agentEmail,
    });
  } catch (error) {
    console.error('Error sending fee breakdown email:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
