import { Session } from 'next-auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral } from '@/models/referral';
import { LenderMC } from '@/models/lender';
import { Agent } from '@/models/agent';
import { Payment } from '@/models/payment';
import { differenceInBusinessDays } from 'date-fns';

interface GetReferralsParams {
  session: Session | null;
  page?: number;
  status?: string | null;
  mc?: string | null;
  agent?: string | null;
  state?: string | null;
  zip?: string | null;
}

const PAGE_SIZE = 20;

export async function getReferrals(params: GetReferralsParams) {
  const { session, page = 1, status, mc, agent, state, zip } = params;
  await connectMongo();

  const query: Record<string, unknown> = { deletedAt: null };

  if (status) query.status = status;
  if (zip) query.propertyZip = zip;
  if (state) query.propertyZip = new RegExp(`^${state}`, 'i');

  if (session?.user?.role === 'mc') {
    query.lender = session.user.id;
  }
  if (session?.user?.role === 'agent') {
    query.assignedAgent = session.user.id;
  }
  if (mc) {
    const lender = await LenderMC.findOne({
      $or: [{ name: new RegExp(mc, 'i') }, { email: new RegExp(mc, 'i') }]
    });
    if (lender) {
      query.lender = lender._id;
    }
  }
  if (agent) {
    const agentDoc = await Agent.findOne({
      $or: [{ name: new RegExp(agent, 'i') }, { email: new RegExp(agent, 'i') }]
    });
    if (agentDoc) {
      query.assignedAgent = agentDoc._id;
    }
  }

  const [items, total] = await Promise.all([
    Referral.find(query)
      .populate('assignedAgent')
      .populate('lender')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Referral.countDocuments(query)
  ]);

  return {
    items: items.map((item) => ({
      _id: item._id.toString(),
      createdAt: item.createdAt,
      borrowerName: item.borrower.name,
      borrowerEmail: item.borrower.email,
      propertyZip: item.propertyZip,
      status: item.status,
      assignedAgentName: item.assignedAgent ? (item.assignedAgent as any).name : undefined,
      lenderName: item.lender ? (item.lender as any).name : undefined,
      referralFeeDueCents: item.referralFeeDueCents
    })),
    total,
    page,
    pageSize: PAGE_SIZE
  };
}

export async function getReferralById(id: string) {
  await connectMongo();
  const referral = await Referral.findById(id)
    .populate('assignedAgent')
    .populate('lender')
    .populate('buyer')
    .lean();
  if (!referral) return null;

  const payments = await Payment.find({ referralId: referral._id }).lean();
  const daysInStatus = differenceInBusinessDays(new Date(), referral.statusLastUpdated ?? referral.createdAt);

  return {
    ...referral,
    _id: referral._id.toString(),
    assignedAgent: referral.assignedAgent ? { ...referral.assignedAgent, _id: referral.assignedAgent._id.toString() } : null,
    lender: referral.lender ? { ...referral.lender, _id: referral.lender._id.toString() } : null,
    buyer: referral.buyer ? { ...referral.buyer, _id: referral.buyer._id.toString() } : null,
    payments: payments.map((payment) => ({ ...payment, _id: payment._id.toString() })),
    daysInStatus
  };
}
