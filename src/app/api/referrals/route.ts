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
import { ReferralMetadata } from '@/models/referral-metadata';
import { resolveAuditActorId } from '@/lib/server/audit';
import { logReferralActivity } from '@/lib/server/activities';
import { sendTransactionalEmail, isTransactionalEmailConfigured } from '@/lib/email';
import { getReferralNotificationRecipients } from '@/lib/server/cc-recipients';
import { buildReferralLink } from '@/lib/referral-links';
import { normalizePhoneNumber } from '@/utils/phone-utils';
import { generateAndReconcileAdminTasks } from '@/lib/server/admin-task-reconciler';
import { resolveOriginalLenderId } from '@/lib/server/referral-transfer';
import { createAdminNotifications } from '@/lib/server/notifications';
import { User } from '@/models/user';
import { createPendingLoanFileNumber, displayLoanFileNumber } from '@/utils/loan-file-number';
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
        mcTransfers: { day: [], week: [], month: [], ytd: [], all: [] },
        agentClosings: { day: [], week: [], month: [], ytd: [], all: [] },
        agentCloseRate: { day: [], week: [], month: [], ytd: [], all: [] }
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
          expectedRevenueCents: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Under Contract', 'Closed', 'Paid']] },
                '$referralFeeDueCents',
                0
              ]
            }
          },
          activePipeline: {
            $sum: {
              $cond: [
                { $in: ['$status', ['Closed', 'Terminated', 'Lost']] },
                0,
                1
              ]
            }
          },
          mcTransferCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$origin', 'admin'] }, { $ne: ['$lender', null] }] },
                1,
                0
              ]
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
            status: { $in: ['closed', 'payment_sent', 'paid'] }
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
            status: { $ne: 'terminated' },
            $or: [
              { status: 'paid' },
              { receivedAmountCents: { $gt: 0 } }
            ]
          }
        },
        {
          $group: {
            _id: null,
            amount: {
              $sum: {
                $cond: [
                  { $gt: ['$receivedAmountCents', 0] },
                  '$receivedAmountCents',
                  0
                ]
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
            status: { $in: ['closed', 'payment_sent', 'paid'] }
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
            status: { $in: ['closed', 'payment_sent', 'paid'] }
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
                $cond: [
                  { $gt: ['$receivedAmountCents', 0] },
                  '$receivedAmountCents',
                  0
                ]
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
            status: {
              $in: [
                'under_contract',
                'past_inspection',
                'past_appraisal',
                'clear_to_close',
                'closed',
                'payment_sent',
                'paid',
              ]
            }
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
                  {
                    $and: [
                      { $eq: ['$referral.org', 'AFC'] },
                      { $ne: ['$usedAfc', true] },
                      { $ne: ['$side', 'sell'] },
                      { $ne: ['$referral.dealSide', 'sell'] },
                      { $ne: ['$referral.clientType', 'Seller'] }
                    ]
                  },
                  1,
                  0
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
            status: { $in: ['closed', 'payment_sent', 'paid'] }
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
                $cond: [
                  { $gt: ['$receivedAmountCents', 0] },
                  '$receivedAmountCents',
                  0
                ]
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
          mcTransfers: { day: [], week: [], month: [], ytd: [], all: [] },
          agentClosings: { day: [], week: [], month: [], ytd: [], all: [] },
          agentCloseRate: { day: [], week: [], month: [], ytd: [], all: [] }
        });
      }

    const now = new Date();
    const timeframes: Record<'day' | 'week' | 'month' | 'ytd' | 'all', Date> = {
      day: startOfDay(now),
      week: startOfWeek(now, { weekStartsOn: 0 }),
      month: startOfMonth(now),
      ytd: startOfYear(now),
      all: startOfDay(new Date(0))
    };

    const mcTransfers: Record<string, any[]> = {};
    const agentClosings: Record<string, any[]> = {};
    const agentReferralTotals: Record<string, any[]> = {};

    // Transfers are credited to the original (first-assigned) MC, not whoever the
    // referral was later reassigned to. We fetch the transfer referrals once and
    // bucket them per timeframe in JS using the audit-derived original lender.
    const transferReferrals = await Referral.find({
      ...referralMatch,
      origin: 'admin',
      lender: { $ne: null }
    })
      .select('createdAt lender audit')
      .lean<{ createdAt?: Date; lender?: Types.ObjectId | null; audit?: any[] }[]>();

    (Object.entries(timeframes) as [keyof typeof timeframes, Date][]).forEach(([key, start]) => {
      const counts = new Map<string, number>();
      transferReferrals.forEach((referral) => {
        if (!referral.createdAt || new Date(referral.createdAt) < start) {
          return;
        }
        const originalLenderId = resolveOriginalLenderId(referral);
        if (!originalLenderId) {
          return;
        }
        counts.set(originalLenderId, (counts.get(originalLenderId) ?? 0) + 1);
      });
      mcTransfers[key] = Array.from(counts.entries())
        .map(([id, transfers]) => ({ _id: id, transfers }))
        .sort((a, b) => b.transfers - a.transfers);
    });

    await Promise.all(
      (Object.entries(timeframes) as [keyof typeof timeframes, Date][]).map(async ([key, start]) => {
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
              status: { $in: ['closed', 'payment_sent', 'paid'] }
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

    const mcTransfersResponse: Record<'day' | 'week' | 'month' | 'ytd' | 'all', any[]> = {
      day: [],
      week: [],
      month: [],
      ytd: [],
      all: []
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

    const agentClosingsResponse: Record<'day' | 'week' | 'month' | 'ytd' | 'all', any[]> = {
      day: [],
      week: [],
      month: [],
      ytd: [],
      all: []
    };

    const agentCloseRateResponse: Record<'day' | 'week' | 'month' | 'ytd' | 'all', any[]> = {
      day: [],
      week: [],
      month: [],
      ytd: [],
      all: []
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
    preApprovalAmount: body.preApprovalAmount ? Number(body.preApprovalAmount) : undefined
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();

  const auditActorId = resolveAuditActorId(session.user.id);

  const borrowerFirstName = parsed.data.borrowerFirstName.trim();
  const borrowerLastName = parsed.data.borrowerLastName.trim();
  const borrowerName = [borrowerFirstName, borrowerLastName].filter(Boolean).join(' ').trim();
  const preApprovalAmount = parsed.data.preApprovalAmount ?? 0;
  const preApprovalAmountCents = Math.round(preApprovalAmount * 100);
  const referralFeeBasisPoints =
    preApprovalAmount > 400000 ? 3500 : DEFAULT_REFERRAL_FEE_BPS;

  const origin: 'agent' | 'mc' | 'admin' =
    session.user.role === 'agent' ? 'agent' : session.user.role === 'mc' ? 'mc' : 'admin';

  const loanFileNumber = parsed.data.loanFileNumber?.trim() ?? '';

  const normalizedZips = Array.isArray(parsed.data.lookingInZips)
    ? Array.from(
        new Set(
          parsed.data.lookingInZips
            .map((zip) => zip.trim())
            .filter((zip) => /^\d{5}$/u.test(zip))
        )
      )
    : [];
  const primaryZipCandidate = parsed.data.lookingInZip;
  const lookingInZips = normalizedZips.length > 0
    ? normalizedZips
    : primaryZipCandidate
    ? [primaryZipCandidate]
    : [];

  if (lookingInZips.length === 0) {
    return NextResponse.json({ error: 'Add at least one valid ZIP code.' }, { status: 400 });
  }

  const primaryZip = lookingInZips[0];

  const providedSource = typeof parsed.data.source === 'string' ? parsed.data.source.trim() : '';
  const providedEndorser = typeof parsed.data.endorser === 'string' ? parsed.data.endorser.trim() : '';

  if (origin !== 'agent') {
    if (!providedSource) {
      return NextResponse.json({ error: 'Referral source is required.' }, { status: 400 });
    }
    if (!providedEndorser) {
      return NextResponse.json({ error: 'Endorser is required.' }, { status: 400 });
    }
    if (!loanFileNumber) {
      return NextResponse.json({ error: 'Loan file number is required.' }, { status: 400 });
    }
    if (!parsed.data.borrowerCurrentAddress?.trim()) {
      return NextResponse.json({ error: 'Borrower current address is required.' }, { status: 400 });
    }
  }

  const source = origin === 'agent' ? '' : providedSource;
  const endorser = origin === 'agent' ? '' : providedEndorser;
  const clientType = origin === 'agent' ? 'Buyer' : parsed.data.clientType;
  const borrowerCurrentAddress =
    origin === 'agent' ? '' : (parsed.data.borrowerCurrentAddress?.trim() ?? '');

  const referralData: Record<string, unknown> = {
    borrower: {
      name: borrowerName,
      firstName: borrowerFirstName,
      lastName: borrowerLastName,
      email: parsed.data.borrowerEmail,
      phone: parsed.data.borrowerPhone
    },
    source,
    endorser,
    clientType,
    lookingInZip: primaryZip,
    lookingInZips,
    borrowerCurrentAddress,
    stageOnTransfer: parsed.data.stageOnTransfer,
    loanType: parsed.data.loanType,
    estPurchasePriceCents: preApprovalAmountCents,
    preApprovalAmountCents,
    commissionBasisPoints: DEFAULT_AGENT_COMMISSION_BPS,
    referralFeeBasisPoints: origin === 'agent' ? 0 : referralFeeBasisPoints,
    referralFeeDueCents:
      origin === 'agent'
        ? 0
        : calculateReferralFeeDue(
            preApprovalAmountCents,
            DEFAULT_AGENT_COMMISSION_BPS,
            referralFeeBasisPoints
          ),
    timeline: parsed.data.timeline ?? 'not_specified',
    audit: [
      {
        ...(auditActorId ? { actorId: auditActorId } : {}),
        actorRole: session.user.role,
        field: 'create',
        previousValue: null,
        newValue: parsed.data,
        timestamp: new Date(),
        ip: ''
      }
    ],
    origin,
  };

  if (loanFileNumber) {
    referralData.loanFileNumber = loanFileNumber;
  } else if (origin === 'agent') {
    // Unique index forbids multiple null loanFileNumbers; store a pending
    // placeholder until an admin fills in the real file number.
    referralData.loanFileNumber = createPendingLoanFileNumber();
  }

  if (session.user.role === 'mc') {
    const lender = await LenderMC.findOne({ userId: session.user.id }).select('_id');
    if (lender) {
      referralData.lender = lender._id;
    }
  }

  let creatorAgentDesignation: string | null = null;
  let creatorAgentEmail: string | null = null;
  if (session.user.role === 'agent') {
    const agent = await Agent.findOne({ userId: session.user.id }).select('_id ahaDesignation email');
    if (agent) {
      const agentId = agent._id;
      creatorAgentDesignation = agent.ahaDesignation ?? null;
      creatorAgentEmail =
        typeof agent.email === 'string' && agent.email.trim() ? agent.email.trim() : null;
      // Agent AFC intros are always buy-side
      referralData.buySideAgent = agentId;
      referralData.assignedAgent = agentId;
    }
  }

  if (parsed.data.initialNotes?.trim() && Types.ObjectId.isValid(session.user.id)) {
    referralData.notes = [
      {
        author: new Types.ObjectId(session.user.id),
        authorName: session.user.name || session.user.email || 'Team Member',
        authorRole: session.user.role,
        content: parsed.data.initialNotes.trim(),
        createdAt: new Date(),
      },
    ];
  }

  // Check for duplicate referrals by email (case-insensitive)
  const normalizedEmail = parsed.data.borrowerEmail.trim();
  const escapedEmail = normalizedEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existingByEmail = await Referral.findOne({
    'borrower.email': { $regex: new RegExp(`^${escapedEmail}$`, 'i') }
  });

  // Check for duplicate referrals by phone (normalized).
  // Uses the indexed `borrower.phoneDigits` field populated by the Referral
  // model's pre-save/pre-update hooks — O(log n) instead of loading every
  // phone-bearing referral into memory.
  let duplicateByPhone: { _id: Types.ObjectId; borrower: { name?: string | null; phone?: string | null } } | null = null;
  const normalizedInputPhone = normalizePhoneNumber(parsed.data.borrowerPhone);
  if (normalizedInputPhone) {
    duplicateByPhone = await Referral.findOne({
      'borrower.phoneDigits': normalizedInputPhone,
      deletedAt: null,
    })
      .select('_id borrower.name borrower.phone')
      .lean<{ _id: Types.ObjectId; borrower: { name?: string | null; phone?: string | null } } | null>();
  }

  // Return error if duplicate found
  if (existingByEmail || duplicateByPhone) {
    const existing = existingByEmail ?? duplicateByPhone;
    const matchField = existingByEmail ? 'email' : 'phone number';
    const existingId = existing?._id ? existing._id.toString() : '';
    const existingName = existing?.borrower?.name ?? '';
    return NextResponse.json(
      {
        message: `A referral with this ${matchField} already exists.`,
        existingReferralId: existingId,
        existingBorrowerName: existingName,
      },
      { status: 409 }
    );
  }

  const referral = await Referral.create(referralData);

  // Save source and endorser to metadata collection (admin only)
  if (session.user.role === 'admin') {
    const metadataUpdates: Promise<unknown>[] = [];

    if (providedSource) {
      const trimmedSource = providedSource.trim();
      metadataUpdates.push(
        (async () => {
          try {
            // Find existing entry case-insensitively
            const existing = await ReferralMetadata.findOne({
              type: 'source',
              value: { $regex: new RegExp(`^${trimmedSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            });

            if (existing) {
              // Update existing entry (preserve original casing, update usage)
              existing.usageCount += 1;
              existing.lastUsedAt = new Date();
              await existing.save();
            } else {
              // Create new entry
              await ReferralMetadata.create({
                type: 'source',
                value: trimmedSource,
                usageCount: 1,
                lastUsedAt: new Date()
              });
            }
          } catch (error) {
            // Ignore duplicate key errors (race condition)
            if ((error as any)?.code !== 11000) {
              console.error('Failed to save source metadata', error);
            }
          }
        })()
      );
    }

    if (providedEndorser) {
      const trimmedEndorser = providedEndorser.trim();
      metadataUpdates.push(
        (async () => {
          try {
            // Find existing entry case-insensitively
            const existing = await ReferralMetadata.findOne({
              type: 'endorser',
              value: { $regex: new RegExp(`^${trimmedEndorser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            });

            if (existing) {
              // Update existing entry (preserve original casing, update usage)
              existing.usageCount += 1;
              existing.lastUsedAt = new Date();
              await existing.save();
            } else {
              // Create new entry
              await ReferralMetadata.create({
                type: 'endorser',
                value: trimmedEndorser,
                usageCount: 1,
                lastUsedAt: new Date()
              });
            }
          } catch (error) {
            // Ignore duplicate key errors (race condition)
            if ((error as any)?.code !== 11000) {
              console.error('Failed to save endorser metadata', error);
            }
          }
        })()
      );
    }

    // Don't await - run in background to avoid slowing down referral creation
    Promise.all(metadataUpdates).catch((error) => {
      console.error('Failed to update referral metadata', error);
    });
  }

  await logReferralActivity({
    referralId: referral._id,
    actorRole: session.user.role,
    actorId: auditActorId ?? session.user.id,
    channel: 'update',
    content: `Created referral for ${borrowerName || 'a new client'}`,
  });

  await generateAndReconcileAdminTasks({
    referralId: referral._id.toString(),
    trigger: 'referral.created',
    actorId: session.user.id,
  }).catch((error) => {
    console.error('[Admin Tasks] Failed to reconcile tasks for new referral:', error);
  });

  // Notify the referral coordinators configured for the account.
  // Skip if AGIT agent created the referral
  const hasAgitCreator = creatorAgentDesignation === 'AGIT';
  if (isTransactionalEmailConfigured() && !hasAgitCreator) {
    (async () => {
      try {
        const coordinatorRecipients = getReferralNotificationRecipients();
        if (coordinatorRecipients.length === 0) {
          return;
        }

        const escapeHtml = (value: string): string => {
          return value.replace(/[&<>"']/g, (char) => {
            switch (char) {
              case '&':
                return '&amp;';
              case '<':
                return '&lt;';
              case '>':
                return '&gt;';
              case '"':
                return '&quot;';
              case "'":
                return '&#39;';
              default:
                return char;
            }
          });
        };

        const referralLink = buildReferralLink(referral._id.toString());
        const summaryFields = [
          `Client Type: ${referral.clientType}`,
          `Zip${referral.lookingInZips && referral.lookingInZips.length > 1 ? 's' : ''}: ${(referral.lookingInZips || [referral.lookingInZip]).join(', ')}`,
          displayLoanFileNumber(referral.loanFileNumber)
            ? `Loan File Number: ${displayLoanFileNumber(referral.loanFileNumber)}`
            : null,
          referral.borrower?.email ? `Email: ${referral.borrower.email}` : null,
          referral.borrower?.phone ? `Phone: ${referral.borrower.phone}` : null,
        ].filter(Boolean) as string[];

        const borrowerLabel = borrowerName || 'New Referral';
        const html = `
          <p>A new referral has been created for <strong>${escapeHtml(borrowerLabel)}</strong>.</p>
          <ul>
            ${summaryFields.map((field) => `<li>${escapeHtml(field)}</li>`).join('')}
          </ul>
          <p><a href="${referralLink}">View the referral</a></p>
        `;
        const text = `A new referral has been created for ${borrowerLabel}.\n\n${summaryFields.join('\n')}\n\nView the referral: ${referralLink}`;

        await sendTransactionalEmail({
          to: coordinatorRecipients,
          subject: `New Referral: ${borrowerLabel}`,
          html,
          text,
          context: { referralId: referral._id.toString() }
        });
      } catch (error) {
        console.error('Failed to send new referral notification email', error);
      }
    })().catch((error) => {
      console.error('Failed to send new referral notification email', error);
    });
  }

  // Notify all admins when an agent creates an AFC referral
  if (session.user.role === 'agent' && !hasAgitCreator) {
    const agentName = session.user.name || session.user.email || 'An agent';
    const borrowerLabel = borrowerName || 'New Referral';

    void createAdminNotifications({
      type: 'referral_created',
      referralId: referral._id,
      borrowerName: borrowerLabel,
      actorRole: session.user.role,
      actorName: agentName,
      content: `${agentName} created a new AFC referral for ${borrowerLabel}.`,
    });

    if (isTransactionalEmailConfigured()) {
      (async () => {
        try {
          const adminUsers = await User.find({ role: 'admin', email: { $ne: null } })
            .select('name email')
            .lean<{ name?: string | null; email?: string | null }[]>();
          const adminEmails = adminUsers
            .map((user) => (typeof user.email === 'string' && user.email ? user.email.trim() : null))
            .filter((email): email is string => Boolean(email));

          if (adminEmails.length === 0) {
            return;
          }

          const escapeHtml = (value: string): string => {
            return value.replace(/[&<>"']/g, (char) => {
              switch (char) {
                case '&':
                  return '&amp;';
                case '<':
                  return '&lt;';
                case '>':
                  return '&gt;';
                case '"':
                  return '&quot;';
                case "'":
                  return '&#39;';
                default:
                  return char;
              }
            });
          };

          const referralLink = buildReferralLink(referral._id.toString());
          const summaryFields = [
            `Agent: ${agentName}`,
            `Client Type: ${referral.clientType}`,
            `Zip${referral.lookingInZips && referral.lookingInZips.length > 1 ? 's' : ''}: ${(referral.lookingInZips || [referral.lookingInZip]).join(', ')}`,
            referral.borrower?.email ? `Email: ${referral.borrower.email}` : null,
            referral.borrower?.phone ? `Phone: ${referral.borrower.phone}` : null,
          ].filter(Boolean) as string[];

          const html = `
            <p><strong>${escapeHtml(agentName)}</strong> created a new AFC referral for <strong>${escapeHtml(borrowerLabel)}</strong>.</p>
            <ul>
              ${summaryFields.map((field) => `<li>${escapeHtml(field)}</li>`).join('')}
            </ul>
            <p>Assign a mortgage consultant from the referral page.</p>
            <p><a href="${referralLink}">View the referral</a></p>
          `;
          const text = `${agentName} created a new AFC referral for ${borrowerLabel}.\n\n${summaryFields.join('\n')}\n\nAssign a mortgage consultant from the referral page.\n\nView the referral: ${referralLink}`;

          await sendTransactionalEmail({
            to: adminEmails,
            subject: `New AFC referral from ${agentName}: ${borrowerLabel}`,
            html,
            text,
          });
        } catch (error) {
          console.error('Failed to send admin AFC referral notification email', error);
        }
      })().catch((error) => {
        console.error('Failed to send admin AFC referral notification email', error);
      });
    }
  }

  // Thank the referring agent for their AFC intro
  if (session.user.role === 'agent' && isTransactionalEmailConfigured()) {
    const agentReceiptEmail =
      creatorAgentEmail ||
      (typeof session.user.email === 'string' && session.user.email.trim()
        ? session.user.email.trim()
        : null);
    const agentGreeting = session.user.name?.trim() || 'there';
    const borrowerLabel = borrowerName || 'your client';

    if (agentReceiptEmail) {
      (async () => {
        try {
          const escapeHtml = (value: string): string => {
            return value.replace(/[&<>"']/g, (char) => {
              switch (char) {
                case '&':
                  return '&amp;';
                case '<':
                  return '&lt;';
                case '>':
                  return '&gt;';
                case '"':
                  return '&quot;';
                case "'":
                  return '&#39;';
                default:
                  return char;
              }
            });
          };

          const referralLink = buildReferralLink(referral._id.toString());
          const html = `
            <p>Hi ${escapeHtml(agentGreeting)},</p>
            <p>Thank you so much for introducing <strong>${escapeHtml(borrowerLabel)}</strong> to AFC — we truly appreciate you trusting us with your client.</p>
            <p>We've received your referral and our team is already on it. We'll pair them with a mortgage consultant shortly and email you again as soon as that happens so you have everything you need.</p>
            <p><a href="${referralLink}">View the referral</a></p>
            <p>We're grateful for the partnership. Thank you again!</p>
          `;
          const text = `Hi ${agentGreeting},

Thank you so much for introducing ${borrowerLabel} to AFC — we truly appreciate you trusting us with your client.

We've received your referral and our team is already on it. We'll pair them with a mortgage consultant shortly and email you again as soon as that happens so you have everything you need.

View the referral: ${referralLink}

We're grateful for the partnership. Thank you again!`;

          await sendTransactionalEmail({
            to: [agentReceiptEmail],
            subject: `We received your referral for ${borrowerLabel} — thank you!`,
            html,
            text,
          });
        } catch (error) {
          console.error('Failed to send agent AFC referral receipt email', error);
        }
      })().catch((error) => {
        console.error('Failed to send agent AFC referral receipt email', error);
      });
    }
  }

  return NextResponse.json({ id: referral._id.toString() }, { status: 201 });
}
