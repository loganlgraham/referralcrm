import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { requireAdmin } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { Payment } from '@/models/payment';
import { ACTIVE_REFERRAL_STATUS_VALUES } from '@/constants/referrals';

type ExportReport = 'referrals' | 'agents' | 'mcs' | 'deals';

// Populated document types for type safety
interface PopulatedAgent {
  _id: unknown;
  name: string;
}

interface PopulatedReferral {
  _id?: unknown;
  borrower?: { name?: string; firstName?: string; lastName?: string };
  status?: string;
  assignedAgent?: PopulatedAgent | null;
  source?: string;
  origin?: string;
  loanFileNumber?: string;
  referralFeeBasisPoints?: number;
  closedPriceCents?: number;
}

interface PopulatedPayment {
  _id?: unknown;
  status: string;
  expectedAmountCents?: number;
  receivedAmountCents?: number;
  contractPriceCents?: number;
  referralFeeBasisPoints?: number;
  referralId?: PopulatedReferral | null;
  agentAttribution?: unknown;
}

type CsvPayload = {
  filename: string;
  rows: string[][];
};

function toCsv({ filename, rows }: CsvPayload): NextResponse {
  const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csvContent = rows.map((row) => row.map((cell) => escapeCell(cell)).join(',')).join('\n');

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv;charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`
    }
  });
}

async function buildReferralRows(): Promise<string[][]> {
  const referrals = await Referral.find({ deletedAt: null })
    .select('borrower status assignedAgent source origin loanFileNumber createdAt referralFeeDueCents lender lookingInZip propertyCity propertyState')
    .populate('assignedAgent', 'name')
    .lean() as unknown as PopulatedReferral[];

  const headers = ['Referral ID', 'Borrower', 'Status', 'Assigned Agent', 'Source'];
  const rows = referrals.map((referral) => {
    const referralId = referral.loanFileNumber || referral._id?.toString();
    const borrowerName = referral.borrower?.name ||
      [referral.borrower?.firstName, referral.borrower?.lastName].filter(Boolean).join(' ');
    const assignedAgent = referral.assignedAgent?.name ?? 'Unassigned';
    const source = referral.source || referral.origin || 'Unknown';

    return [referralId ?? 'Unknown', borrowerName || 'Unknown', referral.status || 'Unknown', assignedAgent, source];
  });

  return [headers, ...rows];
}

async function buildAgentRows(): Promise<string[][]> {
  const [agents, referralCounts] = await Promise.all([
    Agent.find({}).select('name email brokerage markets').lean(),
    Referral.aggregate<{ _id: any; total: number; active: number }>([
      { $match: { deletedAt: null, assignedAgent: { $ne: null } } },
      {
        $group: {
          _id: '$assignedAgent',
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: [
                { $in: ['$status', ACTIVE_REFERRAL_STATUS_VALUES] },
                1,
                0
              ]
            }
          }
        }
      }
    ])
  ]);

  const totals = new Map<string, { total: number; active: number }>();
  referralCounts.forEach((entry) => totals.set(entry._id?.toString(), { total: entry.total, active: entry.active }));

  const headers = ['Agent', 'Brokerage', 'Primary market', 'Active referrals', 'Total referrals', 'Email'];
  const rows = agents.map((agent) => {
    const agentId = agent._id?.toString();
    const stats = agentId ? totals.get(agentId) ?? { total: 0, active: 0 } : { total: 0, active: 0 };
    const primaryMarket = agent.markets?.[0] ?? '—';
    return [
      agent.name,
      agent.brokerage || '—',
      primaryMarket,
      stats.active.toString(),
      stats.total.toString(),
      agent.email
    ];
  });

  return [headers, ...rows];
}

async function buildMcRows(): Promise<string[][]> {
  const [lenders, referralBuckets] = await Promise.all([
    LenderMC.find({}).select('name email team region').lean(),
    Referral.aggregate<{ _id: any; total: number; preApprovals: number }>([
      { $match: { deletedAt: null, lender: { $ne: null } } },
      {
        $group: {
          _id: '$lender',
          total: { $sum: 1 },
          preApprovals: {
            $sum: {
              $cond: [{ $gt: ['$preApprovalAmountCents', 0] }, 1, 0]
            }
          }
        }
      }
    ])
  ]);

  const byLender = new Map<string, { total: number; preApprovals: number }>();
  referralBuckets.forEach((bucket) => byLender.set(bucket._id?.toString(), bucket));

  const headers = ['MC', 'Team / Company', 'Region', 'Referrals received', 'Pre-approvals'];
  const rows = lenders.map((lender) => {
    const lenderId = lender._id?.toString();
    const stats = lenderId ? byLender.get(lenderId) ?? { total: 0, preApprovals: 0 } : { total: 0, preApprovals: 0 };
    return [
      lender.name,
      lender.team || '—',
      lender.region || '—',
      stats.total.toString(),
      stats.preApprovals.toString()
    ];
  });

  return [headers, ...rows];
}

async function buildDealRows(): Promise<string[][]> {
  const payments = await Payment.find({})
    .select('status expectedAmountCents receivedAmountCents contractPriceCents referralFeeBasisPoints referralId agentAttribution')
    .populate({ path: 'referralId', select: 'assignedAgent referralFeeBasisPoints commissionBasisPoints closedPriceCents borrower status', populate: { path: 'assignedAgent', select: 'name' } })
    .lean() as unknown as PopulatedPayment[];

  const headers = ['Deal', 'Status', 'Volume', 'Referral fee %', 'Assigned agent'];
  const rows = payments.map((payment) => {
    const referral = payment.referralId;
    const id = referral?._id?.toString() ?? payment._id?.toString();
    const statusLabel = payment.status.replace(/_/g, ' ');
    const volumeCents = payment.contractPriceCents ?? referral?.closedPriceCents ?? 0;
    const referralFeeBps = payment.referralFeeBasisPoints ?? referral?.referralFeeBasisPoints ?? null;
    const referralFeePercentage = referralFeeBps != null ? `${(referralFeeBps / 100).toFixed(2)}%` : '—';
    const assignedAgent = referral?.assignedAgent?.name ?? 'Unassigned';

    const volume = volumeCents ? `$${(volumeCents / 100).toLocaleString()}` : '—';

    return [id || 'Unknown deal', statusLabel, volume, referralFeePercentage, assignedAgent];
  });

  return [headers, ...rows];
}

async function buildCsv(report: ExportReport): Promise<CsvPayload> {
  switch (report) {
    case 'referrals':
      return { filename: 'referrals-report.csv', rows: await buildReferralRows() };
    case 'agents':
      return { filename: 'agents-report.csv', rows: await buildAgentRows() };
    case 'mcs':
      return { filename: 'mortgage-consultants-report.csv', rows: await buildMcRows() };
    case 'deals':
      return { filename: 'deals-report.csv', rows: await buildDealRows() };
    default:
      throw new Error('Unknown report type');
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const report = searchParams.get('report') as ExportReport | null;

  if (!report) {
    return new NextResponse('Missing report parameter', { status: 400 });
  }

  await connectMongo();

  try {
    await requireAdmin();
  } catch (err) {
    const { status = 401, message = 'Unauthorized' } = err as { status?: number; message?: string };
    return new NextResponse(message, { status });
  }

  try {
    const csvPayload = await buildCsv(report);
    return toCsv(csvPayload);
  } catch (err) {
    console.error('Failed to build CSV export', err);
    return new NextResponse('Unable to generate export right now.', { status: 500 });
  }
}
