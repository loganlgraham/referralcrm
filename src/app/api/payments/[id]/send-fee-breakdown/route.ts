import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import fs from 'fs';
import path from 'path';

import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { generateFeeBreakdownEmailHTML, generateFeeBreakdownSubject } from '@/lib/email-templates/fee-breakdown';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';

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
const DEFAULT_FEE_BREAKDOWN_CC = 'kristen.truong@americanhomeagents.com';

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
      .lean<PaymentLean & { feeBreakdownEmailSentAt?: Date | null }>();

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    // Cron is idempotent: if the payment has already been claimed, short-circuit
    // without calling Resend. Manual admin sends still bypass this so admins can
    // resend at will.
    if (isCronRequest && payment.feeBreakdownEmailSentAt) {
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

    const hasCommission =
      (payment.commissionBasisPoints != null && payment.commissionBasisPoints > 0) ||
      (payment.commissionFlatFeeCents != null && payment.commissionFlatFeeCents > 0);
    if (!payment.contractPriceCents || !hasCommission || !payment.referralFeeBasisPoints) {
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

    // Build platform URL
    const origin = process.env.NEXT_PUBLIC_APP_URL || 
                   (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    const platformUrl = `${origin}/referrals/${(referral._id as Types.ObjectId).toString()}`;

    // Get borrower name for subject line
    const borrowerName = referral.borrower?.name || 'Unknown';

    // Generate email content
    const { html, text } = generateFeeBreakdownEmailHTML({
      agent: {
        name: agent.name || 'Agent',
        email: agentEmail,
      },
      referral: {
        borrowerName,
        propertyAddress: payment.propertyAddress || referral.propertyAddress || 'Address not available',
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
    });

    // Generate subject line with borrower's last name
    const subject = generateFeeBreakdownSubject(borrowerName);
    const ccRecipients = Array.from(
      new Set(
        [DEFAULT_FEE_BREAKDOWN_CC, ...additionalCcRecipients]
          .filter((email): email is string => Boolean(email))
          .filter((email) => email.toLowerCase() !== agentEmail.toLowerCase())
      )
    );

    // Read and prepare PDF attachments
    const attachments = [];
    try {
      const wiringInstructionsPath = path.join(process.cwd(), 'AHA Commission Wiring Instructions.pdf');
      const w9Path = path.join(process.cwd(), 'AHA W9 2026.pdf');

      console.log('[Fee Breakdown] Current working directory:', process.cwd());
      console.log('[Fee Breakdown] Looking for PDFs at:', {
        wiring: wiringInstructionsPath,
        w9: w9Path,
      });

      const wiringExists = fs.existsSync(wiringInstructionsPath);
      const w9Exists = fs.existsSync(w9Path);

      console.log('[Fee Breakdown] PDF files found:', {
        wiring: wiringExists,
        w9: w9Exists,
      });

      if (wiringExists) {
        const wiringInstructionsPdf = fs.readFileSync(wiringInstructionsPath);
        console.log('[Fee Breakdown] Read wiring instructions PDF, size:', wiringInstructionsPdf.length, 'bytes');
        attachments.push({
          filename: 'AHA Commission Wiring Instructions.pdf',
          content: wiringInstructionsPdf,
        });
      }

      if (w9Exists) {
        const w9Pdf = fs.readFileSync(w9Path);
        console.log('[Fee Breakdown] Read W9 PDF, size:', w9Pdf.length, 'bytes');
        attachments.push({
          filename: 'AHA W9 2026.pdf',
          content: w9Pdf,
        });
      }

      console.log('[Fee Breakdown] Attachments prepared:', attachments.length);
    } catch (error) {
      console.error('[Fee Breakdown] Error reading PDF attachments:', error);
      // Continue without attachments rather than failing the entire email
    }

    const actorId = isCronRequest ? 'cron' : (session?.user?.id || 'system');
    const claimedAt = new Date();

    // For cron sends, atomically "claim" the payment before calling Resend.
    // This prevents duplicate sends if two cron workers race or the outer
    // route retries after a transient failure. A missed claim means another
    // worker already won; we treat that as already-sent.
    if (isCronRequest) {
      const claim = await Payment.findOneAndUpdate(
        { _id: paymentId, feeBreakdownEmailSentAt: null },
        {
          $set: {
            feeBreakdownEmailSentAt: claimedAt,
            feeBreakdownEmailSentBy: actorId,
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
    try {
      emailSent = await sendTransactionalEmail({
        to: [agentEmail],
        cc: ccRecipients,
        subject,
        html,
        text,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
    } catch (err) {
      sendError = err;
    }

    if (!emailSent) {
      // Roll back the cron claim so the next run can retry this payment.
      if (isCronRequest) {
        await Payment.updateOne(
          { _id: paymentId, feeBreakdownEmailSentAt: claimedAt },
          { $set: { feeBreakdownEmailSentAt: null, feeBreakdownEmailSentBy: null } }
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
    if (!isCronRequest) {
      await Payment.findByIdAndUpdate(paymentId, {
        feeBreakdownEmailSentAt: claimedAt,
        feeBreakdownEmailSentBy: actorId,
      });
    }

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
