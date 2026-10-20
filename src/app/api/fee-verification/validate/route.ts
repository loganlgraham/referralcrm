import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import {
  FeeBreakdownVerification,
  type FeeBreakdownVerificationLean,
} from '@/models/fee-breakdown-verification';
import { computeFeeVerificationAmounts } from '@/lib/fee-verification';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ valid: false, error: 'This link is missing its code.' }, { status: 400 });
  }

  await connectMongo();

  const verification = await FeeBreakdownVerification.findOne({ token }).lean<FeeBreakdownVerificationLean | null>();
  if (!verification) {
    return NextResponse.json({ valid: false, error: 'This link is not valid.' }, { status: 404 });
  }

  if (verification.status === 'superseded') {
    return NextResponse.json({
      valid: false,
      error: 'A newer fee breakdown was emailed for this deal. Please use the links in the most recent email.',
    });
  }

  if (new Date() > new Date(verification.expiresAt)) {
    return NextResponse.json({
      valid: false,
      error: 'This link has expired. Reply to the fee breakdown email if anything needs a second look.',
    });
  }

  const amounts = computeFeeVerificationAmounts({
    contractPriceCents: verification.snapshot.contractPriceCents,
    commissionBasisPoints: verification.snapshot.commissionBasisPoints ?? null,
    commissionFlatFeeCents: verification.snapshot.commissionFlatFeeCents ?? null,
    referralFeeBasisPoints: verification.snapshot.referralFeeBasisPoints,
  });

  return NextResponse.json({
    valid: true,
    status: verification.status,
    respondedAt: verification.respondedAt ? new Date(verification.respondedAt).toISOString() : null,
    recipientName: verification.recipientName ?? null,
    borrowerName: verification.borrowerName ?? null,
    propertyAddress: verification.propertyAddress ?? null,
    closingDate: verification.snapshot.closingDate
      ? new Date(verification.snapshot.closingDate).toISOString()
      : null,
    amounts,
  });
}
