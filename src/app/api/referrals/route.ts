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
import {
  addWeeks,
  format,
  getISOWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks
} from 'date-fns';

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
        revenueReceivedCents: 0,
        earnedCommissionCents: 0,
        activePipeline: 0,
        mcTransferCount: 0,
        newReferrals30Days: 0,
        ahaDealsLost: 0,
        ahaOosDealsLost: 0,
        afcDealsLost: 0,
        monthly: [],
        weekly: []
      });
    }
    if (leaderboard) {
      return NextResponse.json({
        mcTransfers: { day: [], week: [], month: [], ytd: [] },
        agentClosings: { day: [], week: [], month: [], ytd: [] },
        agentCloseRate: { day: [], week: [], month: [], ytd: [] }
      });
    }
    return NextResponse.json([]);
  }

  const paymentMatch = Object.entries(referralMatch).reduce<Record<string, unknown>>((acc, [key, value]) => {
    acc[`referral.${key}`] = value;
    return acc;
  }, {});

  if (summary) {
    const thirtyDaysAgo = subDays(new Date(), 30);

    const summaryMetrics = await Referral.aggregate([
      { $match: referralMatch },
      {
        $group: {
          _id: null,
          totalReferrals: { $sum: 1 },
          expectedRevenueCents: { $sum: '$referralFeeDueCents' },
          activePipeline: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Closed', 'Terminated']] },
                0,
                1
              ]
            }
          },
          mcTransferCount: {
            $sum: {
              $cond: [{ $eq: ['$source', 'MC'] }, 1, 0]
            }
          },
          newReferrals30Days: {
            $sum: {
              $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, 1, 0]
            }
          }
        }
      }
    ]);

    const metrics = summaryMetrics[0] ?? {
      totalReferrals: 0,
      expectedRevenueCents: 0,
      activePipeline: 0,
      mcTransferCount: 0,
      newReferrals30Days: 0
    };

    const rangeStart = startOfMonth(subMonths(new Date(), 11));
    const weeklyRangeStart = startOfWeek(subWeeks(new Date(), 11), { weekStartsOn: 1 });

    const [
      closedDealAggregation,
      paidRevenueAggregation,
      earnedCommissionAggregation,
      monthlyReferrals,
      monthlyDeals,
      weeklyReferrals,
      weeklyDeals,
      dealOutcomeAggregation
    ] = await Promise.all([
      Payment.aggregate([
        {
          $lookup: {
            from: 'referrals',
            localField: 'referralId',
            foreignField: '_id',
            as: 'referral'
          }
        },
        { $unwind: '$referral' },
        {
          $match: {
            ...paymentMatch,
            status: { $in: ['closed', 'paid'] }
          }
        },
        { $group: { _id: '$referralId' } },
        { $group: { _id: null, count: { $sum: 1 } } }
      ]),
      Payment.aggregate([
        {
          $lookup: {
            from: 'referrals',
            localField: 'referralId',
            foreignField: '_id',
            as: 'referral'
          }
        },
        { $unwind: '$referral' },
        {
          $match: {
            ...paymentMatch,
            status: 'paid'
          }
        },
        { $group: { _id: null, amount: { $sum: '$receivedAmountCents' } } }
      ]),
      Payment.aggregate([
        {
          $lookup: {
            from: 'referrals',
            localField: 'referralId',
            foreignField: '_id',
            as: 'referral'
          }
        },
        { $unwind: '$referral' },
        {
          $match: {
            ...paymentMatch,
            status: { $in: ['closed', 'paid'] }
          }
        },
        { $group: { _id: null, amount: { $sum: '$expectedAmountCents' } } }
      ]),
      Referral.aggregate([
        {
          $match: {
            ...referralMatch,
            createdAt: { $gte: rangeStart }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' }
            },
            totalReferrals: { $sum: 1 },
            mcTransfers: {
              $sum: {
                $cond: [{ $eq: ['$source', 'MC'] }, 1, 0]
              }
            }
          }
        }
      ]),
      Payment.aggregate([
        {
          $lookup: {
            from: 'referrals',
            localField: 'referralId',
            foreignField: '_id',
            as: 'referral'
          }
        },
        { $unwind: '$referral' },
        {
          $match: {
            ...paymentMatch,
            status: { $in: ['closed', 'paid'] }
          }
        },
        {
          $addFields: {
            metricDate: {
              $ifNull: [
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$status', 'paid'] },
                        { $ne: ['$paidDate', null] }
                      ]
                    },
                    '$paidDate',
                    '$updatedAt'
                  ]
                },
                '$updatedAt'
              ]
            }
          }
        },
        {
          $match: {
            metricDate: { $gte: rangeStart }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$metricDate' },
              month: { $month: '$metricDate' }
            },
            dealsClosed: { $sum: 1 },
            revenueReceivedCents: {
              $sum: {
                $cond: [{ $eq: ['$status', 'paid'] }, '$receivedAmountCents', 0]
              }
            }
          }
        }
      ]),
      Referral.aggregate([
        {
          $match: {
            ...referralMatch,
            createdAt: { $gte: weeklyRangeStart }
          }
        },
        {
          $group: {
            _id: {
              year: { $isoWeekYear: '$createdAt' },
              week: { $isoWeek: '$createdAt' }
            },
            totalReferrals: { $sum: 1 },
            mcTransfers: {
              $sum: {
                $cond: [{ $eq: ['$source', 'MC'] }, 1, 0]
              }
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.week': 1 } }
      ]),
      Payment.aggregate([
        {
          $lookup: {
            from: 'referrals',
            localField: 'referralId',
            foreignField: '_id',
            as: 'referral'
          }
        },
        { $unwind: '$referral' },
        {
          $match: {
            ...paymentMatch,
            status: { $in: ['closed', 'paid'] }
          }
        },
        {
          $group: {
            _id: null,
            ahaLost: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$referral.ahaBucket', 'AHA'] },
                      { $ne: ['$agentAttribution', 'AHA'] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            ahaOosLost: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$referral.ahaBucket', 'AHA_OOS'] },
                      { $ne: ['$agentAttribution', 'AHA_OOS'] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            afcLost: {
              $sum: {
                $cond: [
                  { $eq: ['$usedAfc', true] },
                  0,
                  1
                ]
              }
            }
          }
        }
      ])
    ,
      Payment.aggregate([
        {
          $lookup: {
            from: 'referrals',
            localField: 'referralId',
            foreignField: '_id',
            as: 'referral'
          }
        },
        { $unwind: '$referral' },
        {
          $match: {
            ...paymentMatch,
            status: { $in: ['closed', 'paid'] }
          }
        },
        {
          $addFields: {
            metricDate: {
              $ifNull: [
                {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$status', 'paid'] },
                        { $ne: ['$paidDate', null] }
                      ]
                    },
                    '$paidDate',
                    '$updatedAt'
                  ]
                },
                '$updatedAt'
              ]
            }
          }
        },
        {
          $match: {
            metricDate: { $gte: weeklyRangeStart }
          }
        },
        {
          $group: {
            _id: {
              year: { $isoWeekYear: '$metricDate' },
              week: { $isoWeek: '$metricDate' }
            },
            dealsClosed: { $sum: 1 },
            revenueReceivedCents: {
              $sum: {
                $cond: [{ $eq: ['$status', 'paid'] }, '$receivedAmountCents', 0]
              }
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.week': 1 } }
      ])
    ]);

    const closedDeals = closedDealAggregation[0]?.count ?? 0;
    const revenueReceivedCentsTotal = paidRevenueAggregation[0]?.amount ?? 0;
    const earnedCommissionCents = earnedCommissionAggregation[0]?.amount ?? 0;
    const outcomeMetrics = dealOutcomeAggregation[0] ?? { ahaLost: 0, ahaOosLost: 0, afcLost: 0 };
    const closeRate = metrics.totalReferrals === 0 ? 0 : (closedDeals / metrics.totalReferrals) * 100;

    const monthBuckets: { key: string; label: string; year: number; month: number }[] = [];
    const startMonth = rangeStart;

    for (let i = 0; i < 12; i += 1) {
      const date = startOfMonth(new Date(startMonth.getFullYear(), startMonth.getMonth() + i));
      monthBuckets.push({
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        year: date.getFullYear(),
        month: date.getMonth() + 1
      });
    }

    const referralMonthlyMap = new Map<string, { total: number; transfers: number }>();
    monthlyReferrals.forEach((entry: any) => {
      if (!entry?._id) return;
      const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}`;
      referralMonthlyMap.set(key, {
        total: entry.totalReferrals ?? 0,
        transfers: entry.mcTransfers ?? 0
      });
    });

    const dealMonthlyMap = new Map<string, { dealsClosed: number; revenueReceivedCents: number }>();
    monthlyDeals.forEach((entry: any) => {
      if (!entry?._id) return;
      const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}`;
      dealMonthlyMap.set(key, {
        dealsClosed: entry.dealsClosed ?? 0,
        revenueReceivedCents: entry.revenueReceivedCents ?? 0
      });
    });

    const monthly = monthBuckets.map((bucket) => {
      const referralStats = referralMonthlyMap.get(bucket.key) ?? { total: 0, transfers: 0 };
      const dealStats = dealMonthlyMap.get(bucket.key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
      const monthlyCloseRate = referralStats.total === 0
        ? 0
        : (dealStats.dealsClosed / referralStats.total) * 100;

      return {
        monthKey: bucket.key,
        label: bucket.label,
        revenueReceivedCents: dealStats.revenueReceivedCents,
        dealsClosed: dealStats.dealsClosed,
        closeRate: Number(monthlyCloseRate.toFixed(1)),
        mcTransfers: referralStats.transfers
      };
    });

    const weekBuckets: { key: string; label: string }[] = [];
    for (let i = 0; i < 12; i += 1) {
      const start = addWeeks(weeklyRangeStart, i);
      const key = `${start.getFullYear()}-W${String(getISOWeek(start)).padStart(2, '0')}`;
      weekBuckets.push({
        key,
        label: `Week of ${format(start, 'MMM d')}`
      });
    }

    const referralWeeklyMap = new Map<string, { total: number; transfers: number }>();
    weeklyReferrals.forEach((entry: any) => {
      if (!entry?._id) return;
      const key = `${entry._id.year}-W${String(entry._id.week).padStart(2, '0')}`;
      referralWeeklyMap.set(key, {
        total: entry.totalReferrals ?? 0,
        transfers: entry.mcTransfers ?? 0
      });
    });

    const dealWeeklyMap = new Map<string, { dealsClosed: number; revenueReceivedCents: number }>();
    weeklyDeals.forEach((entry: any) => {
      if (!entry?._id) return;
      const key = `${entry._id.year}-W${String(entry._id.week).padStart(2, '0')}`;
      dealWeeklyMap.set(key, {
        dealsClosed: entry.dealsClosed ?? 0,
        revenueReceivedCents: entry.revenueReceivedCents ?? 0
      });
    });

    const weekly = weekBuckets.map((bucket) => {
      const referralStats = referralWeeklyMap.get(bucket.key) ?? { total: 0, transfers: 0 };
      const dealStats = dealWeeklyMap.get(bucket.key) ?? { dealsClosed: 0, revenueReceivedCents: 0 };
      const weeklyCloseRate = referralStats.total === 0
        ? 0
        : (dealStats.dealsClosed / referralStats.total) * 100;

      return {
        monthKey: bucket.key,
        label: bucket.label,
        revenueReceivedCents: dealStats.revenueReceivedCents,
        dealsClosed: dealStats.dealsClosed,
        closeRate: Number(weeklyCloseRate.toFixed(1)),
        mcTransfers: referralStats.transfers
      };
    });

    return NextResponse.json({
      role,
      totalReferrals: metrics.totalReferrals,
      closedReferrals: closedDeals,
      closeRate,
      expectedRevenueCents: metrics.expectedRevenueCents,
      revenueReceivedCents: revenueReceivedCentsTotal,
      earnedCommissionCents,
      activePipeline: metrics.activePipeline ?? 0,
      mcTransferCount: metrics.mcTransferCount ?? 0,
      newReferrals30Days: metrics.newReferrals30Days ?? 0,
      monthly,
      weekly,
      ahaDealsLost: outcomeMetrics.ahaLost ?? 0,
      ahaOosDealsLost: outcomeMetrics.ahaOosLost ?? 0,
      afcDealsLost: outcomeMetrics.afcLost ?? 0
    });
  }

  if (leaderboard) {
    if (role !== 'admin' && role !== 'manager') {
      return NextResponse.json({
        mcTransfers: { day: [], week: [], month: [], ytd: [] },
        agentClosings: { day: [], week: [], month: [], ytd: [] },
        agentCloseRate: { day: [], week: [], month: [], ytd: [] }
      });
    }

    const now = new Date();
    const timeframes: Record<'day' | 'week' | 'month' | 'ytd', Date> = {
      day: startOfDay(now),
      week: startOfWeek(now, { weekStartsOn: 0 }),
      month: startOfMonth(now),
      ytd: startOfYear(now)
    };

    const mcTransfers: Record<string, any[]> = {};
    const agentClosings: Record<string, any[]> = {};
    const agentReferralTotals: Record<string, any[]> = {};

    await Promise.all(
      (Object.entries(timeframes) as [keyof typeof timeframes, Date][]).map(async ([key, start]) => {
        mcTransfers[key] = await Referral.aggregate([
          {
            $match: {
              ...referralMatch,
              createdAt: { $gte: start },
              source: 'MC'
            }
          },
          {
            $group: {
              _id: '$lender',
              transfers: { $sum: 1 }
            }
          },
          { $sort: { transfers: -1 } }
        ]);

        agentClosings[key] = await Payment.aggregate([
          {
            $lookup: {
              from: 'referrals',
              localField: 'referralId',
              foreignField: '_id',
              as: 'referral'
            }
          },
          { $unwind: '$referral' },
          {
            $match: {
              ...paymentMatch,
              status: { $in: ['closed', 'paid'] }
            }
          },
          {
            $addFields: {
              metricDate: {
                $ifNull: [
                  {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$status', 'paid'] },
                          { $ne: ['$paidDate', null] }
                        ]
                      },
                      '$paidDate',
                      '$updatedAt'
                    ]
                  },
                  '$updatedAt'
                ]
              }
            }
          },
          {
            $match: {
              metricDate: { $gte: start }
            }
          },
          {
            $group: {
              _id: '$referral.assignedAgent',
              closings: { $sum: 1 },
              paidRevenueCents: {
                $sum: {
                  $cond: [{ $eq: ['$status', 'paid'] }, '$receivedAmountCents', 0]
                }
              },
              expectedRevenueCents: { $sum: '$expectedAmountCents' }
            }
          },
          { $sort: { closings: -1, expectedRevenueCents: -1 } }
        ]);

        agentReferralTotals[key] = await Referral.aggregate([
          {
            $match: {
              ...referralMatch,
              createdAt: { $gte: start },
              assignedAgent: { $ne: null }
            }
          },
          {
            $group: {
              _id: '$assignedAgent',
              totalReferrals: { $sum: 1 }
            }
          }
        ]);
      })
    );

    const lenderIds = new Set<string>();
    const agentIds = new Set<string>();

    Object.values(mcTransfers).forEach((entries) => {
      entries.forEach((entry) => {
        if (entry?._id) lenderIds.add(entry._id.toString());
      });
    });

    Object.values(agentClosings).forEach((entries) => {
      entries.forEach((entry) => {
        if (entry?._id) agentIds.add(entry._id.toString());
      });
    });

    Object.values(agentReferralTotals).forEach((entries) => {
      entries.forEach((entry) => {
        if (entry?._id) agentIds.add(entry._id.toString());
      });
    });

    const [lenders, agents] = await Promise.all([
      lenderIds.size
        ? LenderMC.find({ _id: { $in: Array.from(lenderIds, (id) => new Types.ObjectId(id)) } }).select('name')
        : Promise.resolve([]),
      agentIds.size
        ? Agent.find({ _id: { $in: Array.from(agentIds, (id) => new Types.ObjectId(id)) } }).select('name')
        : Promise.resolve([])
    ]);

    const lenderNameMap = new Map<string, string>();
    lenders.forEach((lender) => {
      lenderNameMap.set(lender._id.toString(), lender.name || 'Unnamed MC');
    });

    const agentNameMap = new Map<string, string>();
    agents.forEach((agent) => {
      agentNameMap.set(agent._id.toString(), agent.name || 'Unnamed Agent');
    });

    const mcTransfersResponse: Record<'day' | 'week' | 'month' | 'ytd', any[]> = {
      day: [],
      week: [],
      month: [],
      ytd: []
    };

    (Object.keys(mcTransfersResponse) as (keyof typeof mcTransfersResponse)[]).forEach((key) => {
      mcTransfersResponse[key] = mcTransfers[key]
        .filter((entry) => entry?._id)
        .map((entry) => {
          const id = entry._id.toString();
          return {
            id,
            name: lenderNameMap.get(id) || 'Unassigned',
            transfers: entry.transfers ?? 0
          };
        })
        .sort((a, b) => b.transfers - a.transfers)
        .slice(0, 5);
    });

    const agentClosingsResponse: Record<'day' | 'week' | 'month' | 'ytd', any[]> = {
      day: [],
      week: [],
      month: [],
      ytd: []
    };

    const agentCloseRateResponse: Record<'day' | 'week' | 'month' | 'ytd', any[]> = {
      day: [],
      week: [],
      month: [],
      ytd: []
    };

    (Object.keys(agentClosingsResponse) as (keyof typeof agentClosingsResponse)[]).forEach((key) => {
      const closingsEntries = agentClosings[key].filter((entry) => entry?._id);
      const totalsMap = new Map<string, number>();
      agentReferralTotals[key].forEach((entry) => {
        if (!entry?._id) return;
        totalsMap.set(entry._id.toString(), entry.totalReferrals ?? 0);
      });

      const closingFormatted = closingsEntries
        .map((entry) => {
          const id = entry._id.toString();
          return {
            id,
            name: agentNameMap.get(id) || 'Unassigned',
            closings: entry.closings ?? 0,
            paidRevenueCents: entry.paidRevenueCents ?? 0,
            expectedRevenueCents: entry.expectedRevenueCents ?? 0
          };
        })
        .sort((a, b) => {
          if (b.closings === a.closings) {
            return (b.expectedRevenueCents ?? 0) - (a.expectedRevenueCents ?? 0);
          }
          return b.closings - a.closings;
        });

      agentClosingsResponse[key] = closingFormatted.slice(0, 5);

      const ids = new Set<string>();
      closingFormatted.forEach((entry) => ids.add(entry.id));
      totalsMap.forEach((_, id) => ids.add(id));

      const rateEntries = Array.from(ids).map((id) => {
        const closings = closingFormatted.find((item) => item.id === id)?.closings ?? 0;
        const assignedReferrals = totalsMap.get(id) ?? 0;
        const denominator = Math.max(assignedReferrals, closings);
        const rate = denominator === 0 ? 0 : (closings / denominator) * 100;
        return {
          id,
          name: agentNameMap.get(id) || 'Unassigned',
          closeRate: Number(rate.toFixed(1)),
          closings,
          totalReferrals: assignedReferrals === 0 && closings > 0 ? closings : assignedReferrals
        };
      });

      agentCloseRateResponse[key] = rateEntries
        .sort((a, b) => {
          if (b.closeRate === a.closeRate) {
            return b.closings - a.closings;
          }
          return b.closeRate - a.closeRate;
        })
        .slice(0, 5);
    });

    return NextResponse.json({
      mcTransfers: mcTransfersResponse,
      agentClosings: agentClosingsResponse,
      agentCloseRate: agentCloseRateResponse
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
    endorser: parsed.data.endorser,
    clientType: parsed.data.clientType,
    lookingInZip: parsed.data.lookingInZip,
    borrowerCurrentAddress: parsed.data.borrowerCurrentAddress,
    stageOnTransfer: parsed.data.stageOnTransfer,
    loanFileNumber: parsed.data.loanFileNumber,
    initialNotes: parsed.data.initialNotes ?? '',
    loanType: parsed.data.loanType,
    estPurchasePriceCents: parsed.data.estPurchasePrice ? parsed.data.estPurchasePrice * 100 : 0,
    preApprovalAmountCents: parsed.data.estPurchasePrice ? parsed.data.estPurchasePrice * 100 : 0,
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
