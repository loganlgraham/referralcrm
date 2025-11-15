import { Session } from 'next-auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral, ReferralDocument } from '@/models/referral';
import { LenderMC } from '@/models/lender';
import { Agent } from '@/models/agent';
import { Payment } from '@/models/payment';
import { differenceInDays } from 'date-fns';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';
import { ACTIVE_REFERRAL_STATUSES } from '@/constants/referrals';
import { User } from '@/models/user';
import { DEAL_STATUS_LABELS } from '@/constants/deals';

interface GetReferralsParams {
  session: Session | null;
  page?: number;
  status?: string | null;
  mc?: string | null;
  agent?: string | null;
  state?: string | null;
  zip?: string | null;
  ahaBucket?: 'AHA' | 'AHA_OOS' | null;
}

interface PopulatedAgent {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
}

interface PopulatedLender {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
}

interface PopulatedReferral extends Omit<ReferralDocument, 'assignedAgent' | 'lender'> {
  assignedAgent?: PopulatedAgent;
  lender?: PopulatedLender;
}

interface ReferralListItem {
  _id: string;
  createdAt: string;
  borrowerName: string;
  borrowerEmail: string;
  borrowerPhone: string;
  endorser?: string;
  clientType: 'Seller' | 'Buyer' | 'Both';
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
}

const PAGE_SIZE = 20;

export async function getReferrals(params: GetReferralsParams) {
  const { session, page = 1, status, mc, agent, state, zip, ahaBucket } = params;
  await connectMongo();

  const query: Record<string, unknown> = { deletedAt: null };

  if (status) query.status = status;
  const orFilters: Record<string, unknown>[] = [];
  if (zip) {
    orFilters.push({ lookingInZip: zip }, { lookingInZips: zip });
  }
  if (state) {
    const regex = new RegExp(`^${state}`, 'i');
    orFilters.push({ lookingInZip: regex }, { lookingInZips: regex });
  }
  if (orFilters.length > 0) {
    query.$or = orFilters;
  }
  if (ahaBucket === 'AHA' || ahaBucket === 'AHA_OOS') query.ahaBucket = ahaBucket;

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
    query.assignedAgent = agent._id;
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
      query.assignedAgent = new Types.ObjectId(agent);
    } else {
      const agentDoc = await Agent.findOne({
        $or: [{ name: new RegExp(agent, 'i') }, { email: new RegExp(agent, 'i') }]
      });
      if (agentDoc) {
        query.assignedAgent = agentDoc._id;
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
    paymentMatch[`referral.${key}`] = value;
  });

  const activeQuery: Record<string, unknown> = { ...query };

  if (!('status' in activeQuery)) {
    activeQuery.status = { $in: ACTIVE_REFERRAL_STATUSES };
  }

  const [items, total, closedDealAggregation, activeReferrals] = await Promise.all([
    Referral.find(query)
      .populate<{ assignedAgent: PopulatedAgent }>('assignedAgent', 'name email phone')
      .populate<{ lender: PopulatedLender }>('lender', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
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
      const dealRecord = dealStatusMap.get(item._id.toString());
      const dealStatus = dealRecord?.primary ?? dealRecord?.fallback ?? null;
      const dealStatusLabel = dealStatus
        ? DEAL_STATUS_LABELS[dealStatus as keyof typeof DEAL_STATUS_LABELS] ?? null
        : null;

      return {
        _id: item._id.toString(),
        createdAt: item.createdAt.toISOString(),
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
        status: item.status,
        statusLastUpdated: item.statusLastUpdated ? item.statusLastUpdated.toISOString() : null,
        daysInStatus: differenceInDays(new Date(), item.statusLastUpdated ?? item.createdAt),
        assignedAgentName: item.assignedAgent?.name,
        assignedAgentEmail: item.assignedAgent?.email,
        assignedAgentPhone: item.assignedAgent?.phone,
        lenderName: item.lender?.name,
        lenderEmail: item.lender?.email,
        lenderPhone: item.lender?.phone,
        referralFeeDueCents: item.referralFeeDueCents,
        preApprovalAmountCents: item.preApprovalAmountCents,
        dealStatus,
        dealStatusLabel,
        origin:
          item.origin === 'agent' || item.origin === 'mc' || item.origin === 'admin'
            ? item.origin
            : undefined
      } as ReferralListItem;
    }),
    total,
    page,
    pageSize: PAGE_SIZE,
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
    .populate<{ assignedAgent: { _id: Types.ObjectId; name: string; email?: string; phone?: string } }>(
      'assignedAgent',
      'name email phone'
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

  return {
    ...referral,
    _id: referral._id.toString(),
    createdAt: referral.createdAt.toISOString(),
    assignedAgent: referral.assignedAgent
      ? { ...referral.assignedAgent, _id: referral.assignedAgent._id.toString() }
      : null,
    lender: referral.lender ? { ...referral.lender, _id: referral.lender._id.toString() } : null,
    payments: payments.map((payment: any) => ({
      _id: payment._id.toString(),
      status: payment.status,
      expectedAmountCents: payment.expectedAmountCents ?? 0,
      receivedAmountCents: payment.receivedAmountCents ?? 0,
      invoiceDate: payment.invoiceDate ? payment.invoiceDate.toISOString() : null,
      paidDate: payment.paidDate ? payment.paidDate.toISOString() : null,
      createdAt: payment.createdAt ? payment.createdAt.toISOString() : null,
      updatedAt: payment.updatedAt ? payment.updatedAt.toISOString() : null,
      terminatedReason: payment.terminatedReason ?? null,
      agentAttribution: payment.agentAttribution ?? null,
      usedAfc: Boolean(payment.usedAfc),
      usedAssignedAgent: Boolean(payment.usedAssignedAgent),
      commissionBasisPoints: payment.commissionBasisPoints ?? null,
      referralFeeBasisPoints: payment.referralFeeBasisPoints ?? null,
      side: payment.side ?? null,
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
