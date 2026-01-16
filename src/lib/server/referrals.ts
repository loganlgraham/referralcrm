import { Session } from 'next-auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral, ReferralDocument } from '@/models/referral';
import { LenderMC } from '@/models/lender';
import { Agent } from '@/models/agent';
import { Payment } from '@/models/payment';
import { differenceInDays } from 'date-fns';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { ACTIVE_REFERRAL_STATUS_VALUES, normalizeReferralStatus } from '@/constants/referrals';
import { User } from '@/models/user';
import { DEAL_STATUS_LABELS } from '@/constants/deals';
import { Zip } from '@/models/zip';

interface GetReferralsParams {
  session: Session | null;
  page?: number;
  pageSize?: number;
  status?: string | null;
  mc?: string | null;
  agent?: string | null;
  zip?: string | null;
  ahaBucket?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  agentReferrals?: 'yes' | 'no' | null;
  search?: string | null;
  timeline?: string | null;
  sortBy?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
}

interface PopulatedAgent {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
}

interface PopulatedLender {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
}

interface PopulatedReferral
  extends Omit<ReferralDocument, 'assignedAgent' | 'lender' | 'buySideAgent' | 'sellSideAgent'> {
  assignedAgent?: PopulatedAgent;
  buySideAgent?: PopulatedAgent;
  sellSideAgent?: PopulatedAgent;
  lender?: PopulatedLender;
  updatedAt?: Date;
}

interface ReferralListItem {
  _id: string;
  createdAt: string;
  updatedAt?: string | null;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  endorser?: string;
  clientType: 'Seller' | 'Buyer' | 'Both';
  dealSide?: 'buy' | 'sell' | null;
  lookingInZip: string;
  lookingInZips?: string[];
  borrowerCurrentAddress?: string;
  propertyAddress?: string;
  stageOnTransfer?: string;
  initialNotes?: string;
  loanFileNumber: string;
  status: string;
  statusLastUpdated?: string | null;
  daysInStatus?: number;
  assignedAgentName?: string;
  buySideAgentName?: string;
  sellSideAgentName?: string;
  assignedAgentEmail?: string;
  assignedAgentPhone?: string;
  lenderName?: string;
  lenderEmail?: string;
  lenderPhone?: string;
  referralFeeDueCents?: number;
  preApprovalAmountCents?: number;
  dealStatus?: string | null;
  dealStatusLabel?: string | null;
  origin?: 'agent' | 'mc' | 'admin';
  timeline?: 'asap' | '1-3_months' | '3-6_months' | '6-12_months' | '12+_months' | 'not_specified';
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
  hasAhaOosAgentAttached?: boolean;
  hasAhaDesignatedAgentAttached?: boolean;
}

const PAGE_SIZE = 20;

/**
 * Maps client-side sort keys to MongoDB sort objects
 */
function getSortObject(sortBy: string | null | undefined, sortDirection: 'asc' | 'desc' | null | undefined): Record<string, 1 | -1> {
  const direction: 1 | -1 = sortDirection === 'asc' ? 1 : -1;
  const defaultSort: Record<string, 1 | -1> = { createdAt: -1 };
  
  if (!sortBy) {
    return defaultSort;
  }

  // Map client sort keys to MongoDB field paths
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    borrowerName: { 'borrower.name': direction },
    createdAt: { createdAt: direction },
    updatedAt: { updatedAt: direction },
    status: { status: direction },
    assignedAgentName: { 'assignedAgent.name': direction },
    lenderName: { 'lender.name': direction },
    loanFileNumber: { loanFileNumber: direction },
    timeline: { timeline: direction, createdAt: direction }, // Secondary sort by createdAt for consistency
  };

  return sortMap[sortBy] || defaultSort;
}

export async function getReferrals(params: GetReferralsParams) {
  const { session, page = 1, pageSize, status, mc, agent, zip, ahaBucket, agentReferrals, search, timeline, sortBy, sortDirection } = params;
  await connectMongo();
  
  // Validate pageSize - must be one of: 20, 25, 50, 100 (default to 25)
  const validPageSizes = [20, 25, 50, 100];
  const effectivePageSize = pageSize && validPageSizes.includes(pageSize) ? pageSize : 25;

  const query: Record<string, unknown> = { deletedAt: null };
  const appendOrConditions = (conditions: Record<string, unknown>[]) => {
    if (query.$or) {
      query.$and = [...(Array.isArray(query.$and) ? (query.$and as unknown[]) : []), { $or: query.$or }, { $or: conditions }];
      delete query.$or;
    } else {
      query.$or = conditions;
    }
  };

  if (status) query.status = status;

  if (zip) {
    const trimmedZip = zip.trim();
    if (trimmedZip) {
      const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const zipRegex = new RegExp(`^${escapeRegExp(trimmedZip)}`, 'i');
      const zipDocs = await Zip.find({ code: zipRegex }).select('code').limit(100).lean();
      const zipCandidates = new Set<string>();

      zipDocs.forEach((entry) => {
        if (entry.code) {
          zipCandidates.add(entry.code);
        }
      });

      const normalizedZip = trimmedZip.replace(/\D/g, '').slice(0, 5);
      if (normalizedZip) {
        zipCandidates.add(normalizedZip);
      }

      const zipList = Array.from(zipCandidates).filter(Boolean);
      appendOrConditions([
        { lookingInZip: { $in: zipList } },
        { lookingInZips: { $in: zipList } },
        { propertyPostalCode: zipRegex },
      ]);
    }
  }
  if (ahaBucket === 'AHA' || ahaBucket === 'AHA_OOS' || ahaBucket === 'AGIT') {
    const agentsWithDesignation = await Agent.find({
      ahaDesignation: ahaBucket
    }).select('_id').lean<{ _id: Types.ObjectId }[]>();
    
    if (agentsWithDesignation.length > 0) {
      const agentIds = agentsWithDesignation.map((agent) => agent._id);
      appendOrConditions([
        { assignedAgent: { $in: agentIds } },
        { buySideAgent: { $in: agentIds } },
        { sellSideAgent: { $in: agentIds } },
      ]);
    } else {
      // If no agents match the designation, return no results
      query._id = new Types.ObjectId('000000000000000000000000');
    }
  }

  const searchTerm = search?.trim();
  if (searchTerm) {
    const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizedDigits = searchTerm.replace(/\D/g, '');
    const searchConditions: Record<string, unknown>[] = [
      { 'borrower.name': new RegExp(escapedSearch, 'i') },
      { 'borrower.email': new RegExp(escapedSearch, 'i') },
      { 'borrower.phone': new RegExp(escapedSearch, 'i') },
      { loanFileNumber: new RegExp(escapedSearch, 'i') },
    ];
    if (normalizedDigits) {
      searchConditions.push({ 'borrower.phone': new RegExp(normalizedDigits) });
    }
    appendOrConditions(searchConditions);
  }

  if (session?.user?.role === 'admin') {
    if (agentReferrals === 'yes') {
      query.origin = 'agent';
    } else if (agentReferrals === 'no') {
      query.origin = { $ne: 'agent' };
    }
  }

  if (session?.user?.role === 'mc') {
    const lender = await LenderMC.findOne({ userId: session.user.id }).select('_id');
    if (!lender) {
      return {
        items: [],
        total: 0,
        page,
        pageSize: PAGE_SIZE
      };
    }
    query.lender = lender._id;
  }
  if (session?.user?.role === 'agent') {
    const agent = await Agent.findOne({ userId: session.user.id }).select('_id');
    if (!agent) {
      return {
        items: [],
        total: 0,
        page,
        pageSize: PAGE_SIZE
      };
    }
    appendOrConditions([
      { assignedAgent: agent._id },
      { buySideAgent: agent._id },
      { sellSideAgent: agent._id },
    ]);
  }
  if (mc) {
    if (Types.ObjectId.isValid(mc)) {
      query.lender = new Types.ObjectId(mc);
    } else {
      const lender = await LenderMC.findOne({
        $or: [{ name: new RegExp(mc, 'i') }, { email: new RegExp(mc, 'i') }]
      });
      if (lender) {
        query.lender = lender._id;
      }
    }
  }
  if (agent) {
    if (Types.ObjectId.isValid(agent)) {
      appendOrConditions([
        { assignedAgent: new Types.ObjectId(agent) },
        { buySideAgent: new Types.ObjectId(agent) },
        { sellSideAgent: new Types.ObjectId(agent) },
      ]);
    } else {
      const agentDoc = await Agent.findOne({
        $or: [{ name: new RegExp(agent, 'i') }, { email: new RegExp(agent, 'i') }]
      });
      if (agentDoc) {
        appendOrConditions([
          { assignedAgent: agentDoc._id },
          { buySideAgent: agentDoc._id },
          { sellSideAgent: agentDoc._id },
        ]);
      }
    }
  }

  const paymentMatch: Record<string, unknown> = {};
  Object.entries(query).forEach(([key, value]) => {
    if (key === '$or' && Array.isArray(value)) {
      paymentMatch.$or = value.map((clause) => {
        const scoped = Object.entries(clause).map(([innerKey, innerValue]) => [
          `referral.${innerKey}`,
          innerValue,
        ]);
        return Object.fromEntries(scoped);
      });
      return;
    }
    if (key === '$and' && Array.isArray(value)) {
      paymentMatch.$and = value.map((clause) => {
        if (clause && typeof clause === 'object' && '$or' in (clause as Record<string, unknown>)) {
          const innerOr = (clause as any).$or as Record<string, unknown>[];
          return {
            $or: innerOr.map((innerClause) => {
              const scoped = Object.entries(innerClause).map(([innerKey, innerValue]) => [
                `referral.${innerKey}`,
                innerValue,
              ]);
              return Object.fromEntries(scoped);
            })
          };
        }
        const scoped = Object.entries(clause as Record<string, unknown>).map(([innerKey, innerValue]) => [
          `referral.${innerKey}`,
          innerValue,
        ]);
        return Object.fromEntries(scoped);
      });
      return;
    }
    paymentMatch[`referral.${key}`] = value;
  });

  const activeQuery: Record<string, unknown> = { ...query };

  if (!('status' in activeQuery)) {
    activeQuery.status = { $in: ACTIVE_REFERRAL_STATUS_VALUES };
  }

  const sortObject = getSortObject(sortBy, sortDirection);

  const [items, total, closedDealAggregation, activeReferrals] = await Promise.all([
    Referral.find(query)
      .populate<{ assignedAgent: PopulatedAgent }>('assignedAgent', 'name email phone ahaDesignation')
      .populate<{ buySideAgent: PopulatedAgent }>('buySideAgent', 'name email phone ahaDesignation')
      .populate<{ sellSideAgent: PopulatedAgent }>('sellSideAgent', 'name email phone ahaDesignation')
      .populate<{ lender: PopulatedLender }>('lender', 'name email phone')
      .sort(sortObject)
      .skip((page - 1) * effectivePageSize)
      .limit(effectivePageSize)
      .lean<PopulatedReferral[]>(),
    Referral.countDocuments(query),
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
    Referral.countDocuments(activeQuery)
  ]);

  const closedDeals = closedDealAggregation[0]?.count ?? 0;
  const closeRate = total === 0 ? 0 : (closedDeals / total) * 100;

  const referralIds = items.map((item) => item._id);
  const resolveAgent = (item: PopulatedReferral) => {
    const buyAgent = item.buySideAgent ?? null;
    const sellAgent = item.sellSideAgent ?? null;
    const hasBuyAgent = Boolean(buyAgent);
    const hasSellAgent = Boolean(sellAgent);
    const preferredSide: 'buy' | 'sell' = (() => {
      if (item.dealSide === 'sell') {
        return 'sell';
      }
      if (item.dealSide === 'buy') {
        if (hasBuyAgent || !hasSellAgent) {
          return 'buy';
        }
        return 'sell';
      }
      if (item.clientType === 'Seller') {
        return 'sell';
      }
      if (item.clientType === 'Buyer') {
        return 'buy';
      }
      if (!hasBuyAgent && hasSellAgent) {
        return 'sell';
      }
      return 'buy';
    })();

    if (preferredSide === 'sell') {
      return sellAgent ?? buyAgent ?? item.assignedAgent ?? null;
    }
    return buyAgent ?? sellAgent ?? item.assignedAgent ?? null;
  };
  const paymentDocs = await Payment.find({ referralId: { $in: referralIds } })
    .sort({ createdAt: -1 })
    .select('referralId status')
    .lean<{ referralId: Types.ObjectId; status?: string }[]>();

  const dealStatusMap = new Map<string, { primary?: string; fallback?: string }>();
  for (const payment of paymentDocs) {
    const status = typeof payment.status === 'string' ? payment.status : null;
    if (!status) {
      continue;
    }
    const key = payment.referralId.toString();
    const record = dealStatusMap.get(key) ?? {};
    if (!record.fallback) {
      record.fallback = status;
    }
    if (!record.primary && status !== 'terminated') {
      record.primary = status;
    }
    dealStatusMap.set(key, record);
  }

  return {
    items: items.map((item: PopulatedReferral) => {
      const agent = resolveAgent(item);
      const dealRecord = dealStatusMap.get(item._id.toString());
      const dealStatus = dealRecord?.primary ?? dealRecord?.fallback ?? null;
      const dealStatusLabel = dealStatus
        ? DEAL_STATUS_LABELS[dealStatus as keyof typeof DEAL_STATUS_LABELS] ?? null
        : null;

      const normalizedStatus = normalizeReferralStatus(item.status) ?? item.status;

      // Compute hasAhaOosAgentAttached: check if any attached agent has ahaDesignation === 'AHA_OOS'
      const hasAhaOosAgentAttached = Boolean(
        item.assignedAgent?.ahaDesignation === 'AHA_OOS' ||
        item.buySideAgent?.ahaDesignation === 'AHA_OOS' ||
        item.sellSideAgent?.ahaDesignation === 'AHA_OOS'
      );

      // Compute hasAhaDesignatedAgentAttached: check if any attached agent has ahaDesignation in ['AHA', 'AHA_OOS', 'AGIT']
      const hasAhaDesignatedAgentAttached = Boolean(
        (item.assignedAgent?.ahaDesignation === 'AHA' || item.assignedAgent?.ahaDesignation === 'AHA_OOS' || item.assignedAgent?.ahaDesignation === 'AGIT') ||
        (item.buySideAgent?.ahaDesignation === 'AHA' || item.buySideAgent?.ahaDesignation === 'AHA_OOS' || item.buySideAgent?.ahaDesignation === 'AGIT') ||
        (item.sellSideAgent?.ahaDesignation === 'AHA' || item.sellSideAgent?.ahaDesignation === 'AHA_OOS' || item.sellSideAgent?.ahaDesignation === 'AGIT')
      );

      return {
        _id: item._id.toString(),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt ? item.updatedAt.toISOString() : null,
        borrowerName: item.borrower.name,
        borrowerEmail: item.borrower.email,
        borrowerPhone: item.borrower.phone,
        endorser: item.endorser,
        clientType: item.clientType,
        lookingInZip: item.lookingInZip ?? '',
        lookingInZips: Array.isArray(item.lookingInZips)
          ? item.lookingInZips
          : item.lookingInZip
          ? [item.lookingInZip]
          : [],
        borrowerCurrentAddress: item.borrowerCurrentAddress,
        propertyAddress: item.propertyAddress,
        stageOnTransfer: item.stageOnTransfer,
        initialNotes: item.initialNotes,
        loanFileNumber: item.loanFileNumber,
        status: normalizedStatus,
        statusLastUpdated: item.statusLastUpdated ? item.statusLastUpdated.toISOString() : null,
        daysInStatus: differenceInDays(new Date(), item.statusLastUpdated ?? item.createdAt),
        assignedAgentName: agent?.name,
        buySideAgentName: item.buySideAgent?.name,
        sellSideAgentName: item.sellSideAgent?.name,
        assignedAgentEmail: agent?.email,
        assignedAgentPhone: agent?.phone,
        lenderName: item.lender?.name,
        lenderEmail: item.lender?.email,
        lenderPhone: item.lender?.phone,
        referralFeeDueCents: item.referralFeeDueCents,
        preApprovalAmountCents: item.preApprovalAmountCents,
        dealSide: item.dealSide === 'sell' ? 'sell' : 'buy',
        dealStatus,
        dealStatusLabel,
        origin:
          item.origin === 'agent' || item.origin === 'mc' || item.origin === 'admin'
            ? item.origin
            : undefined,
        timeline: item.timeline,
        ahaBucket: item.ahaBucket ?? null,
        hasAhaOosAgentAttached,
        hasAhaDesignatedAgentAttached
      } as ReferralListItem;
    }),
    total,
    page,
    pageSize: effectivePageSize,
    summary: {
      total,
      closedDeals,
      closeRate,
      activeReferrals
    }
  };
}

export async function getReferralById(id: string) {
  const session = await getCurrentSession();
  await connectMongo();
  const referral = await Referral.findOne({ _id: id, deletedAt: null })
    .populate<{ assignedAgent: { _id: Types.ObjectId; name: string; email?: string; phone?: string; ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null } }>(
      'assignedAgent',
      'name email phone ahaDesignation'
    )
    .populate<{ buySideAgent: { _id: Types.ObjectId; name: string; email?: string; phone?: string; ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null } }>(
      'buySideAgent',
      'name email phone ahaDesignation'
    )
    .populate<{ sellSideAgent: { _id: Types.ObjectId; name: string; email?: string; phone?: string; ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null } }>(
      'sellSideAgent',
      'name email phone ahaDesignation'
    )
    .populate<{ lender: { _id: Types.ObjectId; name: string; email?: string; phone?: string } }>(
      'lender',
      'name email phone'
    )
    .populate<{ buyer: { _id: Types.ObjectId; name: string } }>('buyer')
    .lean<ReferralDocument>();
  if (!referral) return null;

  const payments = await Payment.find({ referralId: referral._id })
    .sort({ createdAt: -1 })
    .populate('agentId', 'name')
    .lean();
  const daysInStatus = differenceInDays(new Date(), referral.statusLastUpdated ?? referral.createdAt);

  const viewerRole = session?.user?.role ?? 'viewer';
  const adminUsers = (await User.find({ role: 'admin', email: { $ne: null } })
    .select('name email')
    .lean()) as Array<{ name?: string | null; email?: string | null }>;
  const adminContacts = adminUsers.map((admin) => ({
    name: typeof admin.name === 'string' && admin.name.trim() ? admin.name : null,
    email: typeof admin.email === 'string' && admin.email ? admin.email : null,
  }));
  const notes = (referral.notes ?? []).map((note: any) => ({
    id: note._id.toString(),
    authorName: note.authorName,
    authorRole: note.authorRole,
    content: note.content,
    createdAt: note.createdAt instanceof Date ? note.createdAt.toISOString() : new Date(note.createdAt).toISOString(),
    hiddenFromAgent: note.hiddenFromAgent,
    hiddenFromMc: note.hiddenFromMc,
    emailedTargets: Array.isArray(note.emailedTargets) ? note.emailedTargets : []
  }));

  const filteredNotes = notes.filter((note) => {
    if (viewerRole === 'agent' && note.hiddenFromAgent) {
      return false;
    }
    if (viewerRole === 'mc' && note.hiddenFromMc) {
      return false;
    }
    return true;
  });

  // Compute hasAhaOosAgentAttached: check if any attached agent has ahaDesignation === 'AHA_OOS'
  const hasAhaOosAgentAttached = Boolean(
    (referral.assignedAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.buySideAgent as any)?.ahaDesignation === 'AHA_OOS' ||
    (referral.sellSideAgent as any)?.ahaDesignation === 'AHA_OOS'
  );

  // Compute hasAhaDesignatedAgentAttached: check if any attached agent has ahaDesignation in ['AHA', 'AHA_OOS', 'AGIT']
  const hasAhaDesignatedAgentAttached = Boolean(
    ((referral.assignedAgent as any)?.ahaDesignation === 'AHA' || (referral.assignedAgent as any)?.ahaDesignation === 'AHA_OOS' || (referral.assignedAgent as any)?.ahaDesignation === 'AGIT') ||
    ((referral.buySideAgent as any)?.ahaDesignation === 'AHA' || (referral.buySideAgent as any)?.ahaDesignation === 'AHA_OOS' || (referral.buySideAgent as any)?.ahaDesignation === 'AGIT') ||
    ((referral.sellSideAgent as any)?.ahaDesignation === 'AHA' || (referral.sellSideAgent as any)?.ahaDesignation === 'AHA_OOS' || (referral.sellSideAgent as any)?.ahaDesignation === 'AGIT')
  );

  return {
    ...referral,
    _id: referral._id.toString(),
    createdAt: referral.createdAt.toISOString(),
    assignedAgent: referral.assignedAgent
      ? { ...referral.assignedAgent, _id: referral.assignedAgent._id.toString() }
      : null,
    buySideAgent: referral.buySideAgent
      ? { ...referral.buySideAgent, _id: referral.buySideAgent._id.toString() }
      : null,
    sellSideAgent: referral.sellSideAgent
      ? { ...referral.sellSideAgent, _id: referral.sellSideAgent._id.toString() }
      : null,
    lender: referral.lender ? { ...referral.lender, _id: referral.lender._id.toString() } : null,
    hasAhaOosAgentAttached,
    hasAhaDesignatedAgentAttached,
    payments: payments.map((payment: any) => ({
      _id: payment._id.toString(),
      status: payment.status,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
      receivedAmountCents: payment.receivedAmountCents ?? 0,
      netReferralFeePaidCents: payment.netReferralFeePaidCents ?? null,
      invoiceDate: payment.invoiceDate ? payment.invoiceDate.toISOString() : null,
      paidDate: payment.paidDate ? payment.paidDate.toISOString() : null,
      closingDate: payment.closingDate ? payment.closingDate.toISOString() : null,
      createdAt: payment.createdAt ? payment.createdAt.toISOString() : null,
      updatedAt: payment.updatedAt ? payment.updatedAt.toISOString() : null,
      terminatedReason: payment.terminatedReason ?? null,
      agentAttribution: payment.agentAttribution ?? null,
      propertyAddress: payment.propertyAddress ?? null,
      propertyCity: payment.propertyCity ?? null,
      propertyState: payment.propertyState ?? null,
      agent:
        payment.agentId
          ? {
              id:
                typeof payment.agentId === 'string'
                  ? payment.agentId
                  : payment.agentId instanceof Types.ObjectId
                  ? payment.agentId.toString()
                  : payment.agentId._id?.toString?.() ?? '',
              name:
                typeof payment.agentId === 'object' && payment.agentId !== null && 'name' in payment.agentId
                  ? (payment.agentId as { name?: string | null }).name ?? null
                  : null,
            }
          : null,
      usedAfc: Boolean(payment.usedAfc),
      usedAssignedAgent: Boolean(payment.usedAssignedAgent),
      commissionBasisPoints: payment.commissionBasisPoints ?? null,
      referralFeeBasisPoints: payment.referralFeeBasisPoints ?? null,
      contractPriceCents: payment.contractPriceCents ?? null,
      side: payment.side ?? null,
      agentId:
        typeof payment.agentId === 'string'
          ? payment.agentId
          : payment.agentId instanceof Types.ObjectId
          ? payment.agentId.toString()
          : payment.agentId?._id?.toString?.() ?? null,
    })),
    preApprovalAmountCents: typeof referral.preApprovalAmountCents === 'number' ? referral.preApprovalAmountCents : 0,
    estPurchasePriceCents: typeof referral.estPurchasePriceCents === 'number' ? referral.estPurchasePriceCents : 0,
    referralFeeDueCents: typeof referral.referralFeeDueCents === 'number' ? referral.referralFeeDueCents : 0,
    commissionBasisPoints: typeof referral.commissionBasisPoints === 'number' ? referral.commissionBasisPoints : 0,
    referralFeeBasisPoints: typeof referral.referralFeeBasisPoints === 'number' ? referral.referralFeeBasisPoints : 0,
    dealSide: referral.dealSide ?? 'buy',
    lookingInZips: Array.isArray(referral.lookingInZips)
      ? referral.lookingInZips
      : referral.lookingInZip
      ? [referral.lookingInZip]
      : [],
    origin:
      referral.origin === 'agent' || referral.origin === 'mc' || referral.origin === 'admin'
        ? referral.origin
        : 'admin',
    timeline: referral.timeline ?? 'not_specified',
    daysInStatus,
    statusLastUpdated: referral.statusLastUpdated ? referral.statusLastUpdated.toISOString() : null,
    audit: Array.isArray(referral.audit)
      ? referral.audit.map((entry) => ({
          field: typeof entry.field === 'string' ? entry.field : undefined,
          newValue:
            typeof entry.newValue === 'string'
              ? entry.newValue
              : entry.newValue != null
              ? String(entry.newValue)
              : undefined,
          timestamp:
            entry.timestamp instanceof Date
              ? entry.timestamp.toISOString()
              : typeof entry.timestamp === 'string'
              ? entry.timestamp
              : null,
        }))
      : [],
    notes: filteredNotes,
    adminContacts,
    viewerRole
  };
}
