import { NextRequest, NextResponse } from 'next/server';
import { startOfMonth, subYears } from 'date-fns';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Payment } from '@/models/payment';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';

function resolveMetricDate(payment: any): Date {
  if (payment.status === 'paid' && payment.paidDate) {
    return new Date(payment.paidDate);
  }
  if (payment.invoiceDate) {
    return new Date(payment.invoiceDate);
  }
  return new Date(payment.updatedAt ?? payment.createdAt ?? new Date());
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  await connectMongo();
  const session = await getCurrentSession();

  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const role = session.user?.role ?? null;
  const userId = session.user?.id ?? null;
  const lookbackStart = subYears(startOfMonth(new Date()), 1);

  if (!userId || (role !== 'mc' && role !== 'agent')) {
    return NextResponse.json({ role, metrics: null, timeframeLabel: 'Last 12 months' });
  }

  let referralMatch: Partial<Record<'lender' | 'assignedAgent', unknown>> | null = null;

  let referralKey: 'lender' | 'assignedAgent' | null = null;

  if (role === 'mc') {
    const lender = await LenderMC.findOne({ userId }).select('_id');
    if (!lender) {
      return NextResponse.json({ role, metrics: null, timeframeLabel: 'Last 12 months' });
    }
    referralMatch = { lender: lender._id };
    referralKey = 'lender';
  }

  if (role === 'agent') {
    const agent = await Agent.findOne({ userId }).select('_id');
    if (!agent) {
      return NextResponse.json({ role, metrics: null, timeframeLabel: 'Last 12 months' });
    }
    referralMatch = { assignedAgent: agent._id };
    referralKey = 'assignedAgent';
  }

  if (!referralMatch || !referralKey) {
    return NextResponse.json({ role, metrics: null, timeframeLabel: 'Last 12 months' });
  }

  const [referrals, payments] = await Promise.all([
    Referral.find({
      deletedAt: null,
      ...referralMatch,
      createdAt: { $gte: lookbackStart }
    })
      .select('createdAt status')
      .lean(),
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
          [`referral.${referralKey}`]: referralMatch[referralKey]
        }
      }
    ])
  ]);

  const paymentsWithMetric = payments
    .map((payment) => ({
      ...payment,
      metricDate: resolveMetricDate(payment)
    }))
    .filter((payment) => payment.metricDate >= lookbackStart);

  const totalReferrals = referrals.length;
  const dealsClosed = paymentsWithMetric.filter((payment) => payment.status === 'closed' || payment.status === 'paid');
  const dealsUnderContract = paymentsWithMetric.filter((payment) =>
    [
      'under_contract',
      'past_inspection',
      'past_appraisal',
      'clear_to_close',
    ].includes(payment.status)
  );
  const closeRate = totalReferrals === 0 ? 0 : (dealsClosed.length / totalReferrals) * 100;

  const revenueRealizedCents = paymentsWithMetric.reduce((sum, payment) => sum + (payment.receivedAmountCents ?? 0), 0);
  const revenueExpectedCents = paymentsWithMetric.reduce((sum, payment) => {
    if (
      payment.status === 'closed' ||
      payment.status === 'paid' ||
      payment.status === 'payment_sent' ||
      payment.status === 'clear_to_close' ||
      payment.status === 'past_appraisal' ||
      payment.status === 'past_inspection' ||
      payment.status === 'under_contract'
    ) {
      return sum + (payment.expectedAmountCents ?? 0);
    }
    return sum;
  }, 0);

  const averageCommissionCents = role === 'agent'
    ? (() => {
        const commissions = paymentsWithMetric
          .filter((payment) => (payment.receivedAmountCents ?? 0) > 0)
          .map((payment) => payment.receivedAmountCents ?? 0);
        if (!commissions.length) return 0;
        const total = commissions.reduce((sum, value) => sum + value, 0);
        return Math.round(total / commissions.length);
      })()
    : undefined;

  const metrics = {
    totalReferrals,
    dealsClosed: dealsClosed.length,
    activePipeline: dealsUnderContract.length,
    closeRate,
    revenueRealizedCents,
    revenueExpectedCents,
    averageCommissionCents
  };

  return NextResponse.json({ role, metrics, timeframeLabel: 'Last 12 months' });
}
