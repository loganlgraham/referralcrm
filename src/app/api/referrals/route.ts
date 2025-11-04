import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { createReferralSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { calculateReferralFeeDue } from '@/utils/referral';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const summary = searchParams.get('summary');
  const leaderboard = searchParams.get('leaderboard');
  await connectMongo();
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (summary) {
    const [requests, closings, expectedRevenue, receivedRevenue] = await Promise.all([
      Referral.countDocuments({ deletedAt: null }),
      Referral.countDocuments({ status: 'Closed', deletedAt: null }),
      Referral.aggregate([
        { $match: { deletedAt: null } },
        { $group: { _id: null, amount: { $sum: '$referralFeeDueCents' } } }
      ]),
      Payment.aggregate([
        { $group: { _id: null, amount: { $sum: '$receivedAmountCents' } } }
      ])
    ]);

    const totalRequests = requests;
    const totalClosings = closings;
    const conversion = totalRequests === 0 ? 0 : (totalClosings / totalRequests) * 100;
    return NextResponse.json({
      requests: totalRequests,
      closings: totalClosings,
      conversion,
      expectedRevenueCents: expectedRevenue[0]?.amount || 0,
      receivedRevenueCents: receivedRevenue[0]?.amount || 0,
      avgTimeToFirstContactHours: null,
      avgDaysToContract: null,
      avgDaysToClose: null
    });
  }

  if (leaderboard) {
    const byMc = await Referral.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$lender', totalReferrals: { $sum: 1 }, closings: { $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] } }, expectedRevenue: { $sum: '$referralFeeDueCents' } } },
      { $sort: { expectedRevenue: -1 } },
      { $limit: 5 }
    ]);
    const byAgent = await Referral.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$assignedAgent', totalReferrals: { $sum: 1 }, closings: { $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] } }, expectedRevenue: { $sum: '$referralFeeDueCents' } } },
      { $sort: { expectedRevenue: -1 } },
      { $limit: 5 }
    ]);
    const byMarket = await Referral.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$propertyZip', totalReferrals: { $sum: 1 }, closings: { $sum: { $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0] } }, expectedRevenue: { $sum: '$referralFeeDueCents' } } },
      { $sort: { expectedRevenue: -1 } },
      { $limit: 5 }
    ]);

    const formatEntry = (entry: any) => ({
      name: entry._id ? entry._id.toString() : 'Unassigned',
      totalReferrals: entry.totalReferrals,
      closings: entry.closings,
      expectedRevenueCents: entry.expectedRevenue
    });

    return NextResponse.json({
      mc: byMc.map(formatEntry),
      agents: byAgent.map(formatEntry),
      markets: byMarket.map(formatEntry)
    });
  }

  const query: Record<string, unknown> = { deletedAt: null };
  if (session?.user?.role === 'mc') {
    query.lender = session.user.id;
  }
  if (session?.user?.role === 'agent') {
    query.assignedAgent = session.user.id;
  }
  const referrals = await Referral.find(query).sort({ createdAt: -1 }).limit(50).lean();
  return NextResponse.json(referrals);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const parsed = createReferralSchema.safeParse({
    ...body,
    estPurchasePrice: body.estPurchasePrice ? Number(body.estPurchasePrice) : undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();

  const referral = await Referral.create({
    borrower: {
      name: parsed.data.borrowerName,
      email: parsed.data.borrowerEmail,
      phone: parsed.data.borrowerPhone
    },
    source: parsed.data.source,
    propertyZip: parsed.data.propertyZip,
    loanType: parsed.data.loanType,
    estPurchasePriceCents: parsed.data.estPurchasePrice ? parsed.data.estPurchasePrice * 100 : 0,
    commissionBasisPoints: 3000,
    referralFeeBasisPoints: parsed.data.estPurchasePrice && parsed.data.estPurchasePrice > 400000 ? 3500 : 2500,
    referralFeeDueCents: calculateReferralFeeDue(
      (parsed.data.estPurchasePrice || 0) * 100,
      3000,
      parsed.data.estPurchasePrice && parsed.data.estPurchasePrice > 400000 ? 3500 : 2500
    ),
    audit: [
      {
        actorId: session.user.id,
        actorRole: session.user.role,
        field: 'create',
        previousValue: null,
        newValue: parsed.data,
        timestamp: new Date(),
        ip: ''
      }
    ]
  });

  return NextResponse.json({ id: referral._id.toString() }, { status: 201 });
}
