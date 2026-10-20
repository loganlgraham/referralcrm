import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import {
  FeeBreakdownVerification,
  type FeeBreakdownVerificationLean,
} from '@/models/fee-breakdown-verification';
import { Payment } from '@/models/payment';
import { User } from '@/models/user';
import { createAdminNotifications } from '@/lib/server/notifications';
import { FEE_VERIFICATION_FIELDS, feeVerificationFieldLabel } from '@/lib/fee-verification';
import { logReferralActivity } from '@/lib/server/activities';
import { buildCcList, getReferralNotificationRecipients } from '@/lib/server/cc-recipients';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { buildReferralLink } from '@/lib/referral-links';
import { COORDINATOR } from '@/lib/email-templates/fee-breakdown';
import {
  generateFeeVerificationDisputeEmail,
  generateFeeVerificationDisputeSubject,
} from '@/lib/email-templates/fee-verification-dispute';

export const dynamic = 'force-dynamic';

const submitSchema = z
  .object({
    token: z.string().min(1),
    action: z.enum(['confirm', 'report']),
    corrections: z
      .array(
        z.object({
          field: z.enum(FEE_VERIFICATION_FIELDS),
          correctValue: z.string().trim().min(1).max(200),
        })
      )
      .max(FEE_VERIFICATION_FIELDS.length)
      .default([]),
    note: z.string().trim().max(2000).optional(),
  })
  .refine(
    (value) => value.action === 'confirm' || value.corrections.length > 0 || Boolean(value.note),
    { message: 'Tell us which number is off or add a note.' }
  );

export async function POST(request: NextRequest): Promise<NextResponse> {
  const json = await request.json().catch(() => null);
  const parsed = submitSchema.safeParse(json);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid request';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await connectMongo();

  const input = parsed.data;
  const verification = await FeeBreakdownVerification.findOne({ token: input.token }).lean<FeeBreakdownVerificationLean | null>();

  if (!verification) {
    return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 });
  }
  if (verification.status === 'superseded') {
    return NextResponse.json(
      { error: 'A newer fee breakdown was emailed for this deal. Please use the links in the most recent email.' },
      { status: 409 }
    );
  }
  const canReportAfterConfirm = verification.status === 'confirmed' && input.action === 'report';
  if (verification.status !== 'pending' && !canReportAfterConfirm) {
    return NextResponse.json(
      { error: 'This fee breakdown has already been reviewed.' },
      { status: 409 }
    );
  }
  if (new Date() > new Date(verification.expiresAt)) {
    return NextResponse.json({ error: 'This link has expired.' }, { status: 410 });
  }

  const now = new Date();
  const agentName = verification.recipientName || verification.recipientEmail;
  const borrowerName = verification.borrowerName || 'this client';

  const dedupedCorrections =
    input.action === 'report'
      ? Array.from(new Map(input.corrections.map((c) => [c.field, c])).values())
      : [];
  const note = input.action === 'report' ? input.note || null : null;
  const nextStatus = input.action === 'confirm' ? 'confirmed' : 'disputed';

  const verificationUpdate = await FeeBreakdownVerification.updateOne(
    {
      _id: verification._id,
      status: canReportAfterConfirm ? { $in: ['pending', 'confirmed'] } : 'pending',
    },
    {
      $set: {
        status: nextStatus,
        respondedAt: now,
        corrections: dedupedCorrections,
        note,
      },
    }
  );
  if (!verificationUpdate.matchedCount) {
    return NextResponse.json(
      { error: 'This fee breakdown has already been reviewed.' },
      { status: 409 }
    );
  }

  await Payment.updateOne(
    { _id: verification.paymentId },
    { $set: { feeBreakdownVerificationStatus: nextStatus, feeBreakdownVerifiedAt: now } }
  );

  const activityContent =
    nextStatus === 'confirmed'
      ? `${agentName} confirmed the fee breakdown numbers look correct.`
      : `${agentName} reported the fee breakdown numbers look off${
          dedupedCorrections.length > 0
            ? `: ${dedupedCorrections
                .map((c) => `${feeVerificationFieldLabel(c.field)} should be ${c.correctValue}`)
                .join('; ')}`
            : ''
        }${note ? `. Note: ${note}` : ''}`;

  try {
    await logReferralActivity({
      referralId: verification.referralId,
      actorRole: 'agent',
      actorId: null,
      channel: 'update',
      content: activityContent,
    });
  } catch (activityError) {
    console.error('[Fee Verification] Failed to log activity:', activityError);
  }

  try {
    await createAdminNotifications({
      type: nextStatus === 'confirmed' ? 'fee_breakdown_confirmed' : 'fee_breakdown_disputed',
      referralId: verification.referralId.toString(),
      borrowerName,
      actorRole: 'agent',
      actorName: agentName,
      content:
        nextStatus === 'confirmed'
          ? `${agentName} confirmed the fee breakdown numbers for ${borrowerName}.`
          : `${agentName} challenged the fee breakdown numbers for ${borrowerName}. Review the deal.`,
    });
  } catch (notificationError) {
    console.error('[Fee Verification] Failed to notify admins:', notificationError);
  }

  if (nextStatus === 'disputed' && isTransactionalEmailConfigured()) {
    try {
      const adminUsers = await User.find({ role: 'admin' }).select('email').lean<Array<{ email?: string | null }>>();
      const adminEmails = adminUsers
        .map((admin) => admin.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email));
      const { html, text } = generateFeeVerificationDisputeEmail({
        agentName,
        agentEmail: verification.recipientEmail,
        borrowerName,
        propertyAddress: verification.propertyAddress ?? null,
        snapshot: {
          contractPriceCents: verification.snapshot.contractPriceCents,
          commissionBasisPoints: verification.snapshot.commissionBasisPoints ?? null,
          commissionFlatFeeCents: verification.snapshot.commissionFlatFeeCents ?? null,
          referralFeeBasisPoints: verification.snapshot.referralFeeBasisPoints,
          closingDate: verification.snapshot.closingDate ?? null,
        },
        corrections: dedupedCorrections,
        note,
        referralUrl: buildReferralLink(verification.referralId.toString()),
      });
      await sendTransactionalEmail({
        to: [COORDINATOR.email],
        cc: buildCcList(adminEmails, getReferralNotificationRecipients(), COORDINATOR.email),
        subject: generateFeeVerificationDisputeSubject(borrowerName),
        html,
        text,
      });
    } catch (emailError) {
      console.error('[Fee Verification] Failed to send dispute notification:', emailError);
    }
  }

  return NextResponse.json({ success: true, status: nextStatus });
}
