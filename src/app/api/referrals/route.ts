import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { createReferralSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { calculateReferralFeeDue } from '@/utils/referral';
import { DEFAULT_AGENT_COMMISSION_BPS, DEFAULT_REFERRAL_FEE_BPS } from '@/constants/referrals';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const summary = searchParams.get('summary');
  const leaderboard = searchParams.get('leaderboard');
  await connectMongo();
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const role = session.user?.role;
  const userId = session.user?.id;
  const referralMatch: Record<string, unknown> = { deletedAt: null };

  let missingProfile = false;

  if (role === 'mc' && userId) {
    const lender = await LenderMC.findOne({ userId }).select('_id');
    if (!lender) {
      missingProfile = true;
    }
    if (lender) {
      referralMatch.lender = lender._id as Types.ObjectId;
    }
  }

  if (role === 'agent' && userId) {
    const agent = await Agent.findOne({ userId }).select('_id');
    if (!agent) {
      missingProfile = true;
    }
    if (agent) {
      referralMatch.assignedAgent = agent._id as Types.ObjectId;
    }
  }

  if (missingProfile) {
    if (summary) {
      return NextResponse.json({
        role,
        totalReferrals: 0,
        closedReferrals: 0,
        closeRate: 0,
        expectedRevenueCents: 0,
        amountPaidCents: 0,
        earnedCommissionCents: 0
      });
    }
    if (leaderboard) {
      return NextResponse.json({ mc: [], agents: [], markets: [] });
    }
    return NextResponse.json([]);
  }

  if (summary) {
    const summaryMetrics = await Referral.aggregate([
      { $match: referralMatch },
      {
        $group: {
          _id: null,
          totalReferrals: { $sum: 1 },
          closedReferrals: {
            $sum: {
              $cond: [{ $eq: ['$status', 'Closed'] }, 1, 0]
            }
          },
          expectedRevenueCents: { $sum: '$referralFeeDueCents' },
          earnedCommissionCents: {
            $sum: {
              $cond: [{ $eq: ['$status', 'Closed'] }, '$referralFeeDueCents', 0]
            }
          }
        }
      }
    ]);

    const metrics = summaryMetrics[0] ?? {
      totalReferrals: 0,
      closedReferrals: 0,
      expectedRevenueCents: 0,
      earnedCommissionCents: 0
    };

    const paymentMatch = Object.entries(referralMatch).reduce<Record<string, unknown>>((acc, [key, value]) => {
      acc[`referral.${key}`] = value;
      return acc;
    }, {});

    const receivedRevenue = await Payment.aggregate([
      {
        $lookup: {
          from: 'referrals',
          localField: 'referralId',
          foreignField: '_id',
          as: 'referral'
        }
      },
      { $unwind: '$referral' },
      { $match: paymentMatch },
      { $group: { _id: null, amount: { $sum: '$receivedAmountCents' } } }
    ]);

    const closeRate =
      metrics.totalReferrals === 0 ? 0 : (metrics.closedReferrals / metrics.totalReferrals) * 100;

    return NextResponse.json({
      role,
      totalReferrals: metrics.totalReferrals,
      closedReferrals: metrics.closedReferrals,
      closeRate,
      expectedRevenueCents: metrics.expectedRevenueCents,
      amountPaidCents: receivedRevenue[0]?.amount || 0,
      earnedCommissionCents: metrics.earnedCommissionCents
    });
  }

  if (leaderboard) {
    if (role !== 'admin' && role !== 'manager') {
      return NextResponse.json({ mc: [], agents: [], markets: [] });
    }
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

  const referrals = await Referral.find(referralMatch).sort({ createdAt: -1 }).limit(50).lean();
  return NextResponse.json(referrals);
}

export async function POST(request: Request) {
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

  const referralData: Record<string, unknown> = {
    borrower: {
      name: parsed.data.borrowerName,
      email: parsed.data.borrowerEmail,
      phone: parsed.data.borrowerPhone
    },
    source: parsed.data.source,
    propertyZip: parsed.data.propertyZip,
    loanType: parsed.data.loanType,
    estPurchasePriceCents: parsed.data.estPurchasePrice ? parsed.data.estPurchasePrice * 100 : 0,
    commissionBasisPoints: DEFAULT_AGENT_COMMISSION_BPS,
    referralFeeBasisPoints:
      parsed.data.estPurchasePrice && parsed.data.estPurchasePrice > 400000 ? 3500 : DEFAULT_REFERRAL_FEE_BPS,
    referralFeeDueCents: calculateReferralFeeDue(
      (parsed.data.estPurchasePrice || 0) * 100,
      DEFAULT_AGENT_COMMISSION_BPS,
      parsed.data.estPurchasePrice && parsed.data.estPurchasePrice > 400000 ? 3500 : DEFAULT_REFERRAL_FEE_BPS
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
  };

  if (session.user.role === 'mc') {
    const lender = await LenderMC.findOne({ userId: session.user.id }).select('_id');
    if (lender) {
      referralData.lender = lender._id;
    }
  }

  if (session.user.role === 'agent') {
    const agent = await Agent.findOne({ userId: session.user.id }).select('_id');
    if (agent) {
      referralData.assignedAgent = agent._id;
    }
  }

  const referral = await Referral.create(referralData);

  return NextResponse.json({ id: referral._id.toString() }, { status: 201 });
}
