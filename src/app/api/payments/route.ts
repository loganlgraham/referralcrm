import { differenceInDays } from 'date-fns';
import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Types, PipelineStage } from 'mongoose';

import { Payment } from '@/models/payment';
import { paymentSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';
import { Agent } from '@/models/agent';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { logReferralActivity } from '@/lib/server/activities';
import { resolveAuditActorId } from '@/lib/server/audit';
import { buildReferralLink, getReferralAppBaseUrl } from '@/lib/referral-links';
import { createNPSToken } from '@/lib/server/nps';

type ReferralSummary = {
  _id: Types.ObjectId;
  borrower?: { name?: string | null } | null;
  propertyAddress?: string | null;
  lookingInZip?: string | null;
  lookingInZips?: string[] | null;
  assignedAgent?: Types.ObjectId | string | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  estPurchasePriceCents?: number | null;
  preApprovalAmountCents?: number | null;
  referralFeeDueCents?: number | null;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  dealSide?: 'buy' | 'sell' | null;
};

type AgentSummary = {
  _id: Types.ObjectId;
  name?: string | null;
  ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
};

type PaymentWithReferral = {
  _id: Types.ObjectId;
  referralId: ReferralSummary | null;
  status: string;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  contractPriceCents?: number | null;
  propertyCity?: string | null;
  propertyState?: string | null;
  terminatedReason?: string | null;
  closingDate?: Date | null;
  agentAttribution?: string | null;
  usedAfc?: boolean | null;
  usedAssignedAgent?: boolean | null;
  netReferralFeePaidCents?: number | null;
  propertyAddress?: string | null;
  invoiceDate?: Date | null;
  paidDate?: Date | null;
  createdAt?: Date | null;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  side?: 'buy' | 'sell' | null;
  agentId?: Types.ObjectId | AgentSummary | null;
  agentDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  feeBreakdownEmailSentAt?: Date | null;
  feeBreakdownEmailSentBy?: string | null;
};

const toDate = (value?: Date | string | null): Date | null => {
  if (!value) {
    return null;
  }

  const candidate = value instanceof Date ? value : new Date(value);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const minutesBetweenDates = (start: Date | null, end: Date | null): number | null => {
  if (!start || !end) {
    return null;
  }

  const diff = end.getTime() - start.getTime();
  if (diff <= 0) {
    return 0;
  }

  return Math.round(diff / 60000);
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const role = session.user?.role;
  if (role !== 'admin' && role !== 'agent' && role !== 'manager') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page') || 1);
  const pageSizeParam = searchParams.get('pageSize');
  const validPageSizes = [20, 25, 50, 100];
  const pageSize = pageSizeParam && validPageSizes.includes(Number(pageSizeParam)) 
    ? Number(pageSizeParam) 
    : 25;
  const search = searchParams.get('search')?.trim() || null;
  const statusFilter = searchParams.get('status')?.trim() || null;
  const designationParam = searchParams.get('designation')?.trim() || null;
  const validDesignations = ['AHA', 'AHA_OOS', 'AGIT'] as const;
  const designationList = designationParam
    ? designationParam.split(',').map((s) => s.trim()).filter((s): s is typeof validDesignations[number] => validDesignations.includes(s as typeof validDesignations[number]))
    : [];
  const sortBy = searchParams.get('sortBy')?.trim() || null;
  const sortDirection = (searchParams.get('sortDirection')?.trim() as 'asc' | 'desc') || 'desc';

  await connectMongo();

  /**
   * Maps client-side sort keys to MongoDB sort objects for aggregation pipeline
   */
  const getSortObject = (sortBy: string | null, sortDirection: 'asc' | 'desc'): Record<string, 1 | -1> => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    const defaultSort: Record<string, 1 | -1> = { createdAt: -1 };
    
    if (!sortBy) {
      return defaultSort;
    }

    // Map client sort keys to MongoDB field paths
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      referral: { 'referral.borrower.name': direction },
      agent: { 'agent.name': direction, 'assignedAgent.name': direction },
      status: { status: direction },
      closingDate: { closingDate: direction },
      address: { propertyAddress: direction, 'referral.propertyAddress': direction },
      referralFee: { expectedAmountCents: direction },
      receivedAmount: { receivedAmountCents: direction },
      commission: { expectedAmountCents: direction }, // Simplified - commission is computed
      netCommission: { expectedAmountCents: direction, receivedAmountCents: direction }, // Simplified
      dealSide: { side: direction },
      usedAfc: { usedAfc: direction },
      usedAgent: { usedAssignedAgent: direction },
      paid: { status: direction },
      outcome: { usedAfc: direction, usedAssignedAgent: direction },
    };

    return sortMap[sortBy] || defaultSort;
  };

  const filter: Record<string, unknown> = {};
  
  // Add status filter if provided (can be comma-separated)
  if (statusFilter) {
    const statusList = statusFilter.split(',').map(s => s.trim()).filter(Boolean);
    if (statusList.length === 1) {
      filter.status = statusList[0];
    } else if (statusList.length > 1) {
      filter.status = { $in: statusList };
    }
  }

  // Add agent designation filter for admin/manager (server-side)
  if (designationList.length > 0 && (role === 'admin' || role === 'manager')) {
    const agentsWithDesignation = await Agent.find({ ahaDesignation: { $in: designationList } })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();
    const designationAgentIds = agentsWithDesignation.map((a) => a._id);
    if (designationAgentIds.length > 0) {
      filter.agentId = { $in: designationAgentIds };
    } else {
      // No agents match the designation -> no payments
      return NextResponse.json({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25
      });
    }
  }

  if (role === 'agent') {
    const candidateIds: (Types.ObjectId | string)[] = [];
    if (session.user?.id && Types.ObjectId.isValid(session.user.id)) {
      candidateIds.push(new Types.ObjectId(session.user.id));
    }
    if (session.user?.id) {
      candidateIds.push(session.user.id);
    }

    const agentRecord = await Agent.findOne({ userId: session.user?.id })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>();
    if (agentRecord?._id) {
      candidateIds.push(agentRecord._id);
    }

    if (candidateIds.length === 0) {
      return NextResponse.json({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25
      });
    }

    const referralDocs = await Referral.find({ assignedAgent: { $in: candidateIds } })
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();

    const referralFilter = referralDocs.length
      ? { $in: referralDocs.map((doc) => doc._id) }
      : undefined;

    const agentFilter = candidateIds.length ? { $in: candidateIds } : undefined;

    if (referralFilter || agentFilter) {
      filter.$or = [
        ...(referralFilter ? [{ referralId: referralFilter }] : []),
        ...(agentFilter ? [{ agentId: agentFilter }] : []),
      ];
    } else {
      return NextResponse.json({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25
      });
    }
  }

  // Use aggregation if search is provided, otherwise use simple find
  let payments: PaymentWithReferral[];
  let total: number;

  if (search) {
    // Build aggregation pipeline for search
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizedDigits = search.replace(/\D/g, '');
    
    const searchConditions: Record<string, unknown>[] = [
      { 'referral.borrower.name': new RegExp(escapedSearch, 'i') },
      { 'referral.loanFileNumber': new RegExp(escapedSearch, 'i') },
      { propertyAddress: new RegExp(escapedSearch, 'i') },
      { 'referral.propertyAddress': new RegExp(escapedSearch, 'i') }
    ];
    
    if (normalizedDigits) {
      searchConditions.push(
        { 'referral.loanFileNumber': new RegExp(normalizedDigits) },
        { propertyAddress: new RegExp(normalizedDigits) },
        { 'referral.propertyAddress': new RegExp(normalizedDigits) }
      );
    }

    const pipeline: PipelineStage[] = [
      { $match: filter },
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
        $lookup: {
          from: 'agents',
          localField: 'agentId',
          foreignField: '_id',
          as: 'agent'
        }
      },
      {
        $lookup: {
          from: 'agents',
          localField: 'referral.assignedAgent',
          foreignField: '_id',
          as: 'assignedAgent'
        }
      },
      {
        $match: {
          $or: [
            ...searchConditions,
            { 'agent.name': new RegExp(escapedSearch, 'i') },
            { 'assignedAgent.name': new RegExp(escapedSearch, 'i') }
          ]
        }
      },
      { $sort: getSortObject(sortBy, sortDirection) }
    ];

    // Count total
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Payment.aggregate(countPipeline);
    total = countResult[0]?.total ?? 0;

    // Get payment IDs with pagination
    const idsPipeline = [
      ...pipeline,
      { $project: { _id: 1 } },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize }
    ];
    const paymentDocs = await Payment.aggregate(idsPipeline);
    const paymentIds = paymentDocs.map((doc: { _id: Types.ObjectId }) => doc._id);

    // Fetch and populate the payments
    if (paymentIds.length === 0) {
      payments = [];
    } else {
      // Create a map to preserve order from pipeline
      const idOrderMap = new Map(paymentIds.map((id, index) => [id.toString(), index]));
      
      const fetchedPayments = await Payment.find({ _id: { $in: paymentIds } })
        .populate<{ referralId: ReferralSummary }>({
          path: 'referralId',
          select:
            'borrower propertyAddress lookingInZip lookingInZips assignedAgent commissionBasisPoints referralFeeBasisPoints estPurchasePriceCents preApprovalAmountCents referralFeeDueCents ahaBucket loanFileNumber',
        })
        .populate<{ agentId: AgentSummary | Types.ObjectId | null }>({ path: 'agentId', select: 'name' })
        .lean<PaymentWithReferral[]>();
      
      // Sort fetched payments to match the order from pipeline
      payments = fetchedPayments.sort((a, b) => {
        const orderA = idOrderMap.get(a._id.toString()) ?? 0;
        const orderB = idOrderMap.get(b._id.toString()) ?? 0;
        return orderA - orderB;
      });
    }
  } else {
    // No search - use simple find
    const sortObject = getSortObject(sortBy, sortDirection);
    [payments, total] = await Promise.all([
      Payment.find(filter)
        .sort(sortObject)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate<{ referralId: ReferralSummary }>({
          path: 'referralId',
          select:
            'borrower propertyAddress lookingInZip lookingInZips assignedAgent commissionBasisPoints referralFeeBasisPoints estPurchasePriceCents preApprovalAmountCents referralFeeDueCents ahaBucket loanFileNumber',
        })
        .populate<{ agentId: AgentSummary | Types.ObjectId | null }>({ path: 'agentId', select: 'name' })
        .lean<PaymentWithReferral[]>(),
      Payment.countDocuments(filter)
    ]);
  }

  const agentIds = new Set<string>();

  payments.forEach((payment) => {
    const rawAgentId = payment.agentId;
    if (rawAgentId instanceof Types.ObjectId) {
      agentIds.add(rawAgentId.toString());
    } else if (typeof rawAgentId === 'string') {
      agentIds.add(rawAgentId);
    } else if (rawAgentId?._id instanceof Types.ObjectId) {
      agentIds.add(rawAgentId._id.toString());
    } else if (typeof rawAgentId?._id === 'string') {
      agentIds.add(rawAgentId._id);
    }

    const assigned = payment.referralId?.assignedAgent;
    if (assigned instanceof Types.ObjectId) {
      agentIds.add(assigned.toString());
    } else if (typeof assigned === 'string') {
      agentIds.add(assigned);
    }
  });

  const agents = agentIds.size
    ? await Agent.find({ _id: { $in: Array.from(agentIds, (id) => new Types.ObjectId(id)) } })
        .select('name ahaDesignation')
        .lean<AgentSummary[]>()
    : [];

  const agentNameMap = new Map<string, string | null>();
  const agentDesignationMap = new Map<string, 'AHA' | 'AHA_OOS' | 'AGIT' | null>();

  agents.forEach((agent) => {
    const id = agent._id.toString();
    agentNameMap.set(id, agent.name ?? null);
    agentDesignationMap.set(id, agent.ahaDesignation ?? null);
  });

  const feeBreakdownSentByIds = [
    ...new Set(
      payments
        .map((p) => p.feeBreakdownEmailSentBy)
        .filter(
          (s): s is string =>
            typeof s === 'string' &&
            s !== 'cron' &&
            s !== 'system' &&
            Types.ObjectId.isValid(s)
        )
    ),
  ];
  const sentByUserMap = new Map<
    string,
    { id: string; name: string | null; email: string | null }
  >();
  if (feeBreakdownSentByIds.length > 0) {
    const sentByUsers = await User.find({
      _id: { $in: feeBreakdownSentByIds.map((id) => new Types.ObjectId(id)) },
    })
      .select('_id name email')
      .lean() as Array<{ _id: Types.ObjectId; name?: string | null; email?: string | null }>;
    for (const u of sentByUsers) {
      const id = u._id.toString();
      sentByUserMap.set(id, {
        id,
        name: typeof u.name === 'string' && u.name.trim() ? u.name : null,
        email: typeof u.email === 'string' && u.email ? u.email : null,
      });
    }
  }

  const serialized = payments.map((payment) => {
    const referral = payment.referralId ?? null;
    const fallbackReferralId = (payment as any).referralId;
    const referralId = referral?._id?.toString?.() ??
      (fallbackReferralId instanceof Types.ObjectId ? fallbackReferralId.toString() : '');
    const assignedAgentId = referral?.assignedAgent
      ? typeof referral.assignedAgent === 'string'
        ? referral.assignedAgent
        : referral.assignedAgent?.toString?.() ?? null
      : null;

    const agentField = payment.agentId ?? null;
    const agentId = (() => {
      if (!agentField) {
        return '';
      }
      if (agentField instanceof Types.ObjectId) {
        return agentField.toString();
      }
      if (typeof agentField === 'string') {
        return agentField;
      }
      const populatedId = agentField._id;
      if (populatedId instanceof Types.ObjectId) {
        return populatedId.toString();
      }
      if (typeof populatedId === 'string') {
        return populatedId;
      }
      return '';
    })();

    const agentName = (() => {
      const id = agentId || assignedAgentId || '';
      if (id && agentNameMap.has(id)) {
        return agentNameMap.get(id) ?? null;
      }
      if (!agentField || agentField instanceof Types.ObjectId || typeof agentField === 'string') {
        return null;
      }
      return agentField.name ?? null;
    })();

    const agentDesignation = (() => {
      const id = agentId || assignedAgentId || '';
      if (!id) return null;
      return agentDesignationMap.get(id) ?? null;
    })();

    return {
      _id: payment._id.toString(),
      referralId,
      status: payment.status,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
      receivedAmountCents: payment.receivedAmountCents ?? 0,
      contractPriceCents: payment.contractPriceCents ?? null,
      propertyCity: payment.propertyCity ?? null,
      propertyState: payment.propertyState ?? null,
      netReferralFeePaidCents: payment.netReferralFeePaidCents ?? null,
      propertyAddress: payment.propertyAddress ?? null,
      terminatedReason: payment.terminatedReason ?? null,
      closingDate: payment.closingDate ? payment.closingDate.toISOString() : null,
      agentAttribution: payment.agentAttribution ?? null,
      usedAfc: Boolean(payment.usedAfc),
      usedAssignedAgent: Boolean(payment.usedAssignedAgent),
      invoiceDate: payment.invoiceDate ? payment.invoiceDate.toISOString() : null,
      paidDate: payment.paidDate ? payment.paidDate.toISOString() : null,
      commissionBasisPoints: payment.commissionBasisPoints ?? null,
      referralFeeBasisPoints: payment.referralFeeBasisPoints ?? null,
      side: payment.side ?? 'buy',
      feeBreakdownEmailSentAt: payment.feeBreakdownEmailSentAt ? payment.feeBreakdownEmailSentAt.toISOString() : null,
      feeBreakdownEmailSentBy: payment.feeBreakdownEmailSentBy ?? null,
      feeBreakdownEmailSentByUser: (() => {
        const s = typeof payment.feeBreakdownEmailSentBy === 'string'
          ? payment.feeBreakdownEmailSentBy
          : null;
        if (!s || s === 'cron' || s === 'system') return null;
        return sentByUserMap.get(s) ?? null;
      })(),
      agent: agentId
        ? {
            id: agentId,
            name: agentName ?? null,
          }
        : null,
      agentId: agentId || null,
      agentDesignation,
      referral: referral
        ? {
            borrowerName: referral.borrower?.name ?? null,
            propertyAddress: referral.propertyAddress ?? null,
            lookingInZip: (referral as any).lookingInZip ?? null,
            lookingInZips: Array.isArray((referral as any).lookingInZips)
              ? (referral as any).lookingInZips
              : null,
            assignedAgentId:
              typeof referral.assignedAgent === 'string'
                ? referral.assignedAgent
                : referral.assignedAgent?.toString?.() ?? null,
            commissionBasisPoints: referral.commissionBasisPoints ?? null,
            referralFeeBasisPoints: referral.referralFeeBasisPoints ?? null,
            estPurchasePriceCents: referral.estPurchasePriceCents ?? null,
            preApprovalAmountCents: referral.preApprovalAmountCents ?? null,
            referralFeeDueCents: referral.referralFeeDueCents ?? null,
            ahaBucket: (referral as any).ahaBucket ?? null,
            dealSide: (referral as any).dealSide ?? null,
            loanFileNumber: (referral as any).loanFileNumber ?? null,
            endorser: (referral as any).endorser ?? null,
          }
        : null,
    };
  });

  return NextResponse.json({
    items: serialized,
    total,
    page,
    pageSize
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager', 'agent', 'mc'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const role = session.user.role;

  const body = await request.json();
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const referralForCreate = await Referral.findById(parsed.data.referralId);
  if (!referralForCreate) {
    return new NextResponse('Not found', { status: 404 });
  }

  const isAgentOrigin = referralForCreate.origin === 'agent';
  const fallbackSide = referralForCreate.dealSide === 'sell' ? 'sell' : 'buy';
  let defaultAgentId: Types.ObjectId | string | null = null;

  if (session.user.role === 'agent' && referralForCreate.assignedAgent) {
    defaultAgentId = referralForCreate.assignedAgent as Types.ObjectId;
  } else if (session.user.role === 'agent') {
    const agentRecord = await Agent.findOne({ userId: session.user.id })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>();
    defaultAgentId = agentRecord?._id ?? null;
  }

  const payment = await Payment.create({
    referralId: parsed.data.referralId,
    status: parsed.data.status,
    expectedAmountCents: isAgentOrigin ? 0 : parsed.data.expectedAmountCents,
    receivedAmountCents: isAgentOrigin ? 0 : parsed.data.receivedAmountCents,
    terminatedReason: parsed.data.terminatedReason ?? null,
    agentAttribution: parsed.data.agentAttribution ?? null,
    usedAfc: parsed.data.usedAfc ?? true,
    usedAssignedAgent: parsed.data.usedAssignedAgent ?? true,
    netReferralFeePaidCents: isAgentOrigin ? 0 : parsed.data.netReferralFeePaidCents ?? null,
    propertyAddress: parsed.data.propertyAddress ?? null,
    closingDate: parsed.data.closingDate ?? null,
    invoiceDate: parsed.data.invoiceDate,
    paidDate: parsed.data.paidDate,
    notes: parsed.data.notes,
    commissionBasisPoints: parsed.data.commissionBasisPoints ?? null,
    referralFeeBasisPoints: isAgentOrigin ? null : parsed.data.referralFeeBasisPoints ?? null,
    side: parsed.data.side ?? fallbackSide,
    contractPriceCents: parsed.data.contractPriceCents ?? null,
    agentId: parsed.data.agentId ?? defaultAgentId,
    propertyCity: parsed.data.propertyCity ?? null,
    propertyState: parsed.data.propertyState ?? null,
  });
  if (referralForCreate) {
    let referralUpdated = false;
    if (parsed.data.propertyAddress !== undefined) {
      referralForCreate.propertyAddress = parsed.data.propertyAddress ?? '';
      referralUpdated = true;
    }
    if (parsed.data.propertyCity !== undefined) {
      referralForCreate.propertyCity = parsed.data.propertyCity ?? '';
      referralUpdated = true;
    }
    if (parsed.data.propertyState !== undefined) {
      referralForCreate.propertyState = parsed.data.propertyState ?? '';
      referralUpdated = true;
    }
    if (referralUpdated) {
      await referralForCreate.save();
    }
  }

  return NextResponse.json(
    {
      id: payment._id.toString(),
      createdAt: payment.createdAt instanceof Date ? payment.createdAt.toISOString() : new Date().toISOString(),
      expectedAmountCents: payment.expectedAmountCents ?? 0,
      receivedAmountCents: payment.receivedAmountCents ?? 0,
      status: payment.status,
    },
    { status: 201 }
  );
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager', 'agent', 'mc'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const role = session.user.role;

  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const parsed = paymentSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const isTerminating = parsed.data.status === 'terminated';
  const hasTerminationUpdate = isTerminating || parsed.data.terminatedReason !== undefined;
  if (hasTerminationUpdate && role !== 'admin' && role !== 'agent') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();
  const existingPayment = await Payment.findById(body.id);
  if (!existingPayment) {
    return new NextResponse('Not found', { status: 404 });
  }

  const referral = await Referral.findById(existingPayment.referralId)
    .populate('assignedAgent', 'name email _id ahaDesignation')
    .populate('lender', 'name email _id');
  const isAgentOrigin = referral?.origin === 'agent';

  // Check if assigned agent has AGIT designation - skip automated emails if so
  const assignedAgentDesignation = (referral?.assignedAgent as any)?.ahaDesignation ?? null;
  const hasAgitAgent = assignedAgentDesignation === 'AGIT';

  const previousStatus = existingPayment.status;
  const isClosingNow = parsed.data.status === 'closed' && previousStatus !== 'closed';
  const isPayingNow = parsed.data.status === 'paid' && previousStatus !== 'paid';

  let nextContractPriceCents =
    parsed.data.contractPriceCents !== undefined
      ? parsed.data.contractPriceCents
      : existingPayment.contractPriceCents ?? null;
  const nextCommissionBasisPoints =
    parsed.data.commissionBasisPoints !== undefined
      ? parsed.data.commissionBasisPoints ?? null
      : existingPayment.commissionBasisPoints ?? null;
  const nextReferralFeeBasisPoints =
    parsed.data.referralFeeBasisPoints !== undefined
      ? parsed.data.referralFeeBasisPoints ?? null
      : existingPayment.referralFeeBasisPoints ?? null;
  const nextSide =
    parsed.data.side !== undefined ? parsed.data.side ?? existingPayment.side : existingPayment.side;

  let nextExpectedAmountCents = isAgentOrigin ? 0 : existingPayment.expectedAmountCents ?? 0;
  let nextReceivedAmountCents = isAgentOrigin ? 0 : existingPayment.receivedAmountCents ?? 0;
  const hasUsedAssignedAgentUpdate = Object.prototype.hasOwnProperty.call(
    parsed.data,
    'usedAssignedAgent'
  );
  let nextUsedAssignedAgent = hasUsedAssignedAgentUpdate
    ? Boolean(parsed.data.usedAssignedAgent)
    : Boolean(existingPayment.usedAssignedAgent);
  const hasAgentAttributionUpdate = Object.prototype.hasOwnProperty.call(parsed.data, 'agentAttribution');
  const nextAgentAttribution = hasAgentAttributionUpdate
    ? (parsed.data.agentAttribution as string | null | undefined) ?? null
    : (existingPayment.agentAttribution as string | null | undefined) ?? null;
  const shouldRecalculateReferralFee =
    parsed.data.expectedAmountCents === undefined &&
    (parsed.data.contractPriceCents !== undefined ||
      parsed.data.commissionBasisPoints !== undefined ||
      parsed.data.referralFeeBasisPoints !== undefined);

  if (shouldRecalculateReferralFee && !isAgentOrigin) {
    if (
      nextContractPriceCents != null &&
      nextCommissionBasisPoints != null &&
      nextReferralFeeBasisPoints != null
    ) {
      const computed = Math.round(
        (nextContractPriceCents * nextCommissionBasisPoints * nextReferralFeeBasisPoints) / 100_000_000
      );
      if (Number.isFinite(computed) && computed >= 0) {
        nextExpectedAmountCents = computed;
      }
    }
  } else if (parsed.data.expectedAmountCents !== undefined) {
    nextExpectedAmountCents = parsed.data.expectedAmountCents ?? nextExpectedAmountCents;
  }

  if (parsed.data.receivedAmountCents !== undefined) {
    nextReceivedAmountCents = parsed.data.receivedAmountCents ?? nextReceivedAmountCents;
  }

  if (hasUsedAssignedAgentUpdate && !nextUsedAssignedAgent && !isAgentOrigin) {
    nextExpectedAmountCents = 0;
    nextReceivedAmountCents = 0;
  }

  if (hasAgentAttributionUpdate && !isAgentOrigin) {
    if (nextAgentAttribution === 'OUTSIDE_AGENT') {
      nextUsedAssignedAgent = false;
      nextExpectedAmountCents = 0;
      nextReceivedAmountCents = 0;
    } else if (nextAgentAttribution === 'AHA' || nextAgentAttribution === 'AHA_OOS') {
      nextUsedAssignedAgent = true;
    }
  }

  const updatePayload: Record<string, unknown> = { ...parsed.data };
  delete updatePayload.referralId;
  updatePayload.contractPriceCents = nextContractPriceCents ?? null;
  updatePayload.commissionBasisPoints = nextCommissionBasisPoints ?? null;
  updatePayload.referralFeeBasisPoints = isAgentOrigin ? null : nextReferralFeeBasisPoints ?? null;
  updatePayload.side = nextSide ?? 'buy';
  updatePayload.expectedAmountCents = isAgentOrigin ? 0 : nextExpectedAmountCents;
  updatePayload.receivedAmountCents = isAgentOrigin ? 0 : nextReceivedAmountCents;
  if (hasUsedAssignedAgentUpdate) {
    updatePayload.usedAssignedAgent = nextUsedAssignedAgent;
  }
  if (hasAgentAttributionUpdate) {
    updatePayload.agentAttribution = nextAgentAttribution;
    updatePayload.usedAssignedAgent = nextUsedAssignedAgent;
  }
  if ('usedAfc' in updatePayload && updatePayload.usedAfc === undefined) {
    updatePayload.usedAfc = false;
  }
  if ('usedAssignedAgent' in updatePayload && updatePayload.usedAssignedAgent === undefined) {
    updatePayload.usedAssignedAgent = false;
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, 'agentId')) {
    updatePayload.agentId = parsed.data.agentId ?? null;
  } else {
    delete updatePayload.agentId;
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, 'propertyCity')) {
    updatePayload.propertyCity = parsed.data.propertyCity ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, 'propertyState')) {
    updatePayload.propertyState = parsed.data.propertyState ?? null;
  }

  // Only auto-set closing date when status is changing TO closed AND no closing date is provided
  if (isClosingNow && !isAgentOrigin && !Object.prototype.hasOwnProperty.call(parsed.data, 'closingDate')) {
    updatePayload.closingDate = new Date();
  }

  // Auto-set paid date when status is changing TO paid AND no paid date is provided
  if (isPayingNow && !isAgentOrigin && !Object.prototype.hasOwnProperty.call(parsed.data, 'paidDate')) {
    updatePayload.paidDate = new Date();
  }

  const nextStatusValue = parsed.data.status ?? existingPayment.status;
  const hasTerminatedReasonUpdate = Object.prototype.hasOwnProperty.call(parsed.data, 'terminatedReason');
  if (hasTerminatedReasonUpdate && nextStatusValue !== 'terminated') {
    updatePayload.terminatedReason = null;
  }

  if (isAgentOrigin) {
    updatePayload.netReferralFeePaidCents = 0;
    updatePayload.usedAssignedAgent = true;
    updatePayload.usedAfc = existingPayment.usedAfc ?? true;
  }

  const payment = await Payment.findByIdAndUpdate(body.id, updatePayload, { new: true });
  if (!payment) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (referral) {
    if (isAgentOrigin) {
      referral.referralFeeDueCents = 0;
    }

    const now = new Date();
    const previousReferralStatus = referral.status ?? null;
    const sla = (referral.sla ??= {} as any);
    let slaChanged = false;
    let referralStatusChanged = false;

    const shouldMarkLost =
      !isAgentOrigin && (hasUsedAssignedAgentUpdate || hasAgentAttributionUpdate) && !nextUsedAssignedAgent;

    if (shouldMarkLost) {
      referral.estPurchasePriceCents = 0;
      referral.referralFeeDueCents = 0;
      nextContractPriceCents = null;
      if (sla) {
        sla.lastUnderContractAt = null;
        sla.lastClosedAt = null;
        sla.lastPaidAt = null;
        slaChanged = true;
      }

      if (previousReferralStatus !== 'Lost') {
        const auditEntry: Record<string, unknown> = {
          actorRole: session.user.role,
          field: 'status',
          previousValue: previousReferralStatus,
          newValue: 'Lost',
          timestamp: now,
        };
        const actorId = resolveAuditActorId(session.user.id);
        if (actorId) {
          auditEntry.actorId = actorId;
        }

        referral.status = 'Lost';
        referral.statusLastUpdated = now;
        referral.audit = Array.isArray(referral.audit) ? referral.audit : [];
        referral.audit.push(auditEntry as any);
        referral.markModified('audit');
        referralStatusChanged = true;
      }

      await Payment.updateMany(
        { referralId: referral._id },
        { $set: { expectedAmountCents: 0, receivedAmountCents: 0 } }
      );
    }

    if (parsed.data.status && parsed.data.status !== previousStatus && !isAgentOrigin) {
      const nextStatus = parsed.data.status as string;

      if (nextStatus === 'under_contract') {
        sla.lastUnderContractAt = now;
        const createdAt = toDate(referral.createdAt) ?? now;
        if (sla.daysToContract == null) {
          sla.daysToContract = Math.max(differenceInDays(now, createdAt), 0);
        }
        slaChanged = true;
      }

      if (['closed', 'payment_sent', 'paid'].includes(nextStatus)) {
        const underContractAt =
          toDate(sla.lastUnderContractAt) ??
          toDate(existingPayment.createdAt) ??
          toDate(payment.createdAt) ??
          now;
        const closedAt =
          toDate(payment.closingDate) ??
          toDate(existingPayment.closingDate) ??
          now;
        const closedMinutes = minutesBetweenDates(underContractAt, closedAt);
        if (closedMinutes != null) {
          sla.contractToCloseMinutes = closedMinutes;
          sla.daysToClose = Math.max(differenceInDays(closedAt, underContractAt), 0);
          sla.lastClosedAt = closedAt;
          slaChanged = true;
        }
      }

      if (nextStatus === 'paid') {
        const closedAt =
          toDate(payment.closingDate) ??
          toDate(sla.lastClosedAt) ??
          toDate(existingPayment.closingDate) ??
          toDate(existingPayment.updatedAt) ??
          now;
        const paidAt =
          toDate(payment.paidDate) ??
          now;
        const paidMinutes = minutesBetweenDates(closedAt, paidAt);
        if (paidMinutes != null) {
          sla.closedToPaidMinutes = paidMinutes;
          sla.lastPaidAt = paidAt;
          slaChanged = true;
        }
      }
    }

    if (nextContractPriceCents != null) {
      referral.estPurchasePriceCents = nextContractPriceCents;
    }
    if (nextCommissionBasisPoints != null) {
      referral.commissionBasisPoints = nextCommissionBasisPoints;
    }
    if (nextReferralFeeBasisPoints != null) {
      referral.referralFeeBasisPoints = nextReferralFeeBasisPoints;
    }
    if (nextSide) {
      referral.dealSide = nextSide;
    }
    if (parsed.data.propertyAddress !== undefined) {
      referral.propertyAddress = parsed.data.propertyAddress ?? '';
    }
    if (parsed.data.propertyCity !== undefined) {
      referral.propertyCity = parsed.data.propertyCity ?? '';
    }
    if (parsed.data.propertyState !== undefined) {
      referral.propertyState = parsed.data.propertyState ?? '';
    }
    referral.referralFeeDueCents = isAgentOrigin ? 0 : nextExpectedAmountCents;
    if (slaChanged) {
      referral.markModified('sla');
    }

    // Auto-disable update reminders when deal reaches terminal status
    const DEAL_TERMINAL_STATUSES = ['closed', 'payment_sent', 'paid'];
    let autoRemindersDisabledForDeal = false;
    if (
      DEAL_TERMINAL_STATUSES.includes(payment.status) &&
      referral.autoUpdateRemindersEnabled !== false
    ) {
      referral.autoUpdateRemindersEnabled = false;
      referral.audit = referral.audit || [];
      referral.audit.push({
        actorRole: 'system',
        actorId: null,
        field: 'autoUpdateRemindersEnabled',
        previousValue: true,
        newValue: false,
        timestamp: now,
      } as any);
      referral.markModified('audit');
      autoRemindersDisabledForDeal = true;
    }

    await referral.save();

    if (autoRemindersDisabledForDeal) {
      await logReferralActivity({
        referralId: referral._id.toString(),
        actorRole: 'system',
        actorId: null,
        channel: 'update',
        content: `Automated update reminders disabled (deal status: ${payment.status})`,
      });
    }

    if (referralStatusChanged && previousReferralStatus !== referral.status) {
      await logReferralActivity({
        referralId: referral._id,
        actorRole: session.user.role,
        actorId: session.user.id,
        channel: 'status',
        content: `Status changed from ${previousReferralStatus ?? 'Unknown'} to ${referral.status}`,
      });
    }

    // Send congratulatory emails with NPS survey links when deal is closed
    // Skip all automated emails if AGIT agent is attached
    const shouldSendClosedEmails = parsed.data.sendClosedEmails ?? false;
    if (isClosingNow && shouldSendClosedEmails && !hasAgitAgent && isTransactionalEmailConfigured()) {
      const usedAfc = payment.usedAfc ?? existingPayment.usedAfc ?? false;
      const usedAssignedAgent = payment.usedAssignedAgent ?? existingPayment.usedAssignedAgent ?? false;
      const origin = getReferralAppBaseUrl();

      try {
        // Email to referral (borrower) - only if usedAssignedAgent is true
        if (usedAssignedAgent && referral.assignedAgent && referral.borrower?.email) {
          const borrowerEmail = referral.borrower.email;
          const borrowerFirstName = referral.borrower.firstName || 
            (referral.borrower.name ? referral.borrower.name.split(' ')[0] : null) ||
            'there';
          
          const agent = referral.assignedAgent as { _id?: any; name?: string } | null;
          const agentId = agent?._id?.toString();
          
          if (agentId) {
            // Get full agent name from database if needed
            const { Agent } = await import('@/models/agent');
            const agentDoc = await Agent.findById(agentId)
              .select('name')
              .lean<{ name?: string } | null>();
            const agentFullName = agentDoc?.name || agent?.name || 'this agent';
            const borrowerName = referral.borrower.name || referral.borrower.firstName || 'Client';

            // Generate NPS token for agent survey
            const agentSurveyToken = await createNPSToken({
              paymentId: existingPayment._id.toString(),
              referralId: referral._id.toString(),
              type: 'agent',
              targetId: agentId,
              recipientEmail: borrowerEmail,
              recipientName: borrowerName,
              agentName: agentFullName,
            });

            const agentSurveyUrl = `${origin}/nps/agent?token=${agentSurveyToken}`;

            await sendTransactionalEmail({
              to: [borrowerEmail],
              subject: 'Congrats on Your New Home!',
              html: `
                <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 640px; color: #0f172a; line-height: 1.5;">
                  <p>Hi ${borrowerFirstName},</p>
                  <p>Congratulations on closing on your new home! 🎉 If you have a quick moment, we'd really appreciate you leaving a rating for your agent, ${agentFullName}—your feedback means a lot and helps others tremendously. Wishing you all the best in your new place!</p>
                  <p style="margin: 20px 0 0 0;">
                    <a href="${agentSurveyUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none;">
                      Rate Your Agent
                    </a>
                  </p>
                </div>
              `,
              text: `Hi ${borrowerFirstName},\n\nCongratulations on closing on your new home! 🎉 If you have a quick moment, we'd really appreciate you leaving a rating for your agent, ${agentFullName}—your feedback means a lot and helps others tremendously. Wishing you all the best in your new place!\n\nRate your agent: ${agentSurveyUrl}`,
            });
          }
        }

        // Email to agent (only if BOTH usedAfc AND usedAssignedAgent are true)
        if (usedAfc && usedAssignedAgent && referral.assignedAgent && referral.lender) {
          // Handle both populated and ObjectId cases
          const agentId = referral.assignedAgent instanceof Types.ObjectId 
            ? referral.assignedAgent 
            : (referral.assignedAgent as any)?._id;
          const lenderId = referral.lender instanceof Types.ObjectId 
            ? referral.lender 
            : (referral.lender as any)?._id;
          
          if (!agentId || !lenderId) {
            console.warn('Missing agentId or lenderId for closed deal email', {
              paymentId: existingPayment._id.toString(),
              referralId: referral._id.toString(),
              hasAgentId: !!agentId,
              hasLenderId: !!lenderId,
            });
          } else {
            // Fetch agent data if not populated or if email is missing
            let agentEmail: string | null = null;
            let agentName: string | null = null;
            
            if (referral.assignedAgent && typeof referral.assignedAgent === 'object' && 'email' in referral.assignedAgent) {
              // Agent is populated
              agentEmail = (referral.assignedAgent as any).email || null;
              agentName = (referral.assignedAgent as any).name || null;
            }
            
            // Fallback: fetch agent if email is missing
            if (!agentEmail && agentId) {
              const agentDoc = await Agent.findById(agentId).select('name email').lean<{ name?: string; email?: string } | null>();
              if (agentDoc) {
                agentEmail = agentDoc.email || null;
                agentName = agentDoc.name || null;
              }
            }
            
            const lenderIdStr = lenderId.toString();
            
            if (agentEmail && lenderIdStr) {
              const agentFirstName = agentName ? agentName.split(' ')[0] : 'there';
              const { buildPaymentActionLink } = await import('@/lib/referral-links');
              const paymentSentLink = buildPaymentActionLink(existingPayment._id.toString());

              // Generate NPS token for lender survey
              const lenderSurveyToken = await createNPSToken({
                paymentId: existingPayment._id.toString(),
                referralId: referral._id.toString(),
                type: 'lender',
                targetId: lenderIdStr,
                recipientEmail: agentEmail,
                recipientName: agentName || 'Agent',
              });

              const lenderSurveyUrl = `${origin}/nps/lender?token=${lenderSurveyToken}`;
              
              const emailSent = await sendTransactionalEmail({
                to: [agentEmail],
                subject: 'Congrats on your closing!',
                html: `
                  <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 640px; color: #0f172a; line-height: 1.5;">
                    <p>Hi ${agentFirstName},</p>
                    <p>Congrats on your closing! 🎉 It was great working together. If you have a quick moment, we'd really appreciate you rating our partners at American Financing (AFC). Your feedback helps us continue improving and supporting great partnerships. Also, please click the button below when the check is placed in the mail so we can anticipate its arrival. Thank you again!</p>
                    <p style="margin: 20px 0 0 0;">
                      <a href="${lenderSurveyUrl}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none;">
                        Rate American Financing
                      </a>
                    </p>
                    <p style="margin: 20px 0 0 0;">
                      <a href="${paymentSentLink}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none;">
                        Mark Payment as Sent
                      </a>
                    </p>
                  </div>
                `,
                text: `Hi ${agentFirstName},\n\nCongrats on your closing! 🎉 It was great working together. If you have a quick moment, we'd really appreciate you rating our partners at American Financing (AFC). Your feedback helps us continue improving and supporting great partnerships. Also, please click the button below when the check is placed in the mail so we can anticipate its arrival. Thank you again!\n\nRate American Financing: ${lenderSurveyUrl}\n\nMark payment as sent: ${paymentSentLink}`,
              });
              
              if (!emailSent) {
                console.error('Failed to send agent email for closed deal', {
                  paymentId: existingPayment._id.toString(),
                  referralId: referral._id.toString(),
                  agentEmail,
                });
              }
            } else {
              console.warn('Cannot send agent email for closed deal - missing data', {
                paymentId: existingPayment._id.toString(),
                referralId: referral._id.toString(),
                hasAgentEmail: !!agentEmail,
                hasLenderId: !!lenderIdStr,
                agentId: agentId?.toString(),
              });
            }
          }
        }
        // Email to agent when ONLY usedAssignedAgent is true (no AFC)
        else if (usedAssignedAgent && referral.assignedAgent) {
          // Handle both populated and ObjectId cases
          const agentId = referral.assignedAgent instanceof Types.ObjectId 
            ? referral.assignedAgent 
            : (referral.assignedAgent as any)?._id;
          
          if (!agentId) {
            console.warn('Missing agentId for simplified closed deal email', {
              paymentId: existingPayment._id.toString(),
              referralId: referral._id.toString(),
            });
          } else {
            // Fetch agent data if not populated or if email is missing
            let agentEmail: string | null = null;
            let agentName: string | null = null;
            
            if (referral.assignedAgent && typeof referral.assignedAgent === 'object' && 'email' in referral.assignedAgent) {
              // Agent is populated
              agentEmail = (referral.assignedAgent as any).email || null;
              agentName = (referral.assignedAgent as any).name || null;
            }
            
            // Fallback: fetch agent if email is missing
            if (!agentEmail && agentId) {
              const agentDoc = await Agent.findById(agentId).select('name email').lean<{ name?: string; email?: string } | null>();
              if (agentDoc) {
                agentEmail = agentDoc.email || null;
                agentName = agentDoc.name || null;
              }
            }
            
            if (agentEmail) {
              const agentFirstName = agentName ? agentName.split(' ')[0] : 'there';
              const { buildPaymentActionLink } = await import('@/lib/referral-links');
              const paymentSentLink = buildPaymentActionLink(existingPayment._id.toString());
              
              const emailSent = await sendTransactionalEmail({
                to: [agentEmail],
                subject: 'Congrats on your closing!',
                html: `
                  <div style="font-family: Inter, system-ui, -apple-system, sans-serif; max-width: 640px; color: #0f172a; line-height: 1.5;">
                    <p>Hi ${agentFirstName},</p>
                    <p>Congrats on your closing! 🎉 It was great working together. Please click the button below when the referral fee has been sent so we can anticipate its arrival. Thank you again!</p>
                    <p style="margin: 20px 0 0 0;">
                      <a href="${paymentSentLink}" style="display: inline-block; padding: 10px 16px; border-radius: 10px; background: #0f172a; color: #fff; font-weight: 700; text-decoration: none;">
                        Mark Payment as Sent
                      </a>
                    </p>
                  </div>
                `,
                text: `Hi ${agentFirstName},\n\nCongrats on your closing! 🎉 It was great working together. Please click the button below when the referral fee has been sent so we can anticipate its arrival. Thank you again!\n\nMark payment as sent: ${paymentSentLink}`,
              });
              
              if (!emailSent) {
                console.error('Failed to send simplified agent email for closed deal', {
                  paymentId: existingPayment._id.toString(),
                  referralId: referral._id.toString(),
                  agentEmail,
                });
              }
            } else {
              console.warn('Cannot send simplified agent email for closed deal - missing agent email', {
                paymentId: existingPayment._id.toString(),
                referralId: referral._id.toString(),
                agentId: agentId?.toString(),
              });
            }
          }
        } else {
          // Log why email wasn't sent for debugging
          if (isClosingNow) {
            console.log('Agent email not sent for closed deal - conditions not met', {
              paymentId: existingPayment._id.toString(),
              referralId: referral._id.toString(),
              usedAfc,
              usedAssignedAgent,
              hasAssignedAgent: !!referral.assignedAgent,
              hasLender: !!referral.lender,
            });
          }
        }
      } catch (error) {
        console.error('Failed to send congratulatory emails:', error);
        // Don't fail the request if congratulatory emails fail
      }
    }
  }

  if (
    parsed.data.status === 'payment_sent' &&
    previousStatus !== 'payment_sent' &&
    session.user.role === 'agent' &&
    isTransactionalEmailConfigured()
  ) {
    const adminUsers = await User.find({ role: 'admin', email: { $ne: null } })
      .select('name email')
      .lean<{ name?: string | null; email?: string | null }[]>();
    const adminEmails = adminUsers
      .map((user) => (typeof user.email === 'string' && user.email ? user.email : null))
      .filter((email): email is string => Boolean(email));

    if (adminEmails.length > 0) {
      const referral = await Referral.findById(existingPayment.referralId)
        .select('borrower referralFeeDueCents')
        .lean<Pick<ReferralSummary, '_id' | 'borrower' | 'referralFeeDueCents'> | null>();
      const borrowerName = referral?.borrower?.name ?? 'a referral client';
      const amountCents = payment.expectedAmountCents ?? referral?.referralFeeDueCents ?? 0;
      const formattedAmount = amountCents
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amountCents / 100)
        : 'the referral fee';
      const referralLink = referral ? buildReferralLink(referral._id.toString()) : null;
      const agentName = session.user.name ?? 'An agent';

      const textBody = [
        `${agentName} marked the referral fee as Payment Sent for ${borrowerName}.`,
        `Amount: ${formattedAmount}.`,
        referralLink ? `View the referral: ${referralLink}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const htmlBody = `
        <p>${agentName} marked the referral fee as <strong>Payment Sent</strong> for ${borrowerName}.</p>
        <p>Amount: <strong>${formattedAmount}</strong></p>
        ${referralLink ? `<p><a href="${referralLink}" style="color:#2563eb;">View referral details</a></p>` : ''}
      `;

      await sendTransactionalEmail({
        to: adminEmails,
        subject: `${agentName} sent a referral payment for ${borrowerName}`,
        text: textBody,
        html: htmlBody,
      });
    }
  }

  return NextResponse.json({ id: payment._id.toString() });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager', 'agent', 'mc'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request
    .json()
    .catch(() => null) as { id?: string } | null;
  const id = body?.id ?? request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  await connectMongo();
  const payment = await Payment.findById(id);
  if (!payment) {
    return new NextResponse('Not found', { status: 404 });
  }

  await payment.deleteOne();

  return NextResponse.json({ id });
}
