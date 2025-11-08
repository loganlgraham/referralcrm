import { Session } from 'next-auth';
import { connectMongo } from '@/lib/mongoose';
import { Referral, ReferralDocument } from '@/models/referral';
import { LenderMC } from '@/models/lender';
import { Agent } from '@/models/agent';
import { Payment } from '@/models/payment';
import { differenceInDays } from 'date-fns';
import { Types } from 'mongoose';
import { getCurrentSession } from '@/lib/auth';

interface GetReferralsParams {
  session: Session | null;
  page?: number;
  status?: string | null;
  mc?: string | null;
  agent?: string | null;
  state?: string | null;
  zip?: string | null;
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
  propertyZip: string;
  propertyAddress?: string;
  status: string;
  assignedAgentName?: string;
  assignedAgentEmail?: string;
  assignedAgentPhone?: string;
  lenderName?: string;
  lenderEmail?: string;
  lenderPhone?: string;
  referralFeeDueCents?: number;
  preApprovalAmountCents?: number;
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
      .populate<{ assignedAgent: PopulatedAgent }>('assignedAgent', 'name email phone')
      .populate<{ lender: PopulatedLender }>('lender', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean<PopulatedReferral[]>(),
    Referral.countDocuments(query)
  ]);

  return {
    items: items.map((item: PopulatedReferral) => ({
      _id: item._id.toString(),
      createdAt: item.createdAt.toISOString(),
      borrowerName: item.borrower.name,
      borrowerEmail: item.borrower.email,
      borrowerPhone: item.borrower.phone,
      propertyZip: item.propertyZip,
      propertyAddress: item.propertyAddress,
      status: item.status,
      assignedAgentName: item.assignedAgent?.name,
      assignedAgentEmail: item.assignedAgent?.email,
      assignedAgentPhone: item.assignedAgent?.phone,
      lenderName: item.lender?.name,
      lenderEmail: item.lender?.email,
      lenderPhone: item.lender?.phone,
      referralFeeDueCents: item.referralFeeDueCents,
      preApprovalAmountCents: item.preApprovalAmountCents
    } as ReferralListItem)),
    total,
    page,
    pageSize: PAGE_SIZE
  };
}

export async function getReferralById(id: string) {
  const session = await getCurrentSession();
  await connectMongo();
  const referral = await Referral.findById(id)
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
  const notes = (referral.notes ?? []).map((note: any) => ({
    id: note._id.toString(),
    authorName: note.authorName,
    authorRole: note.authorRole,
    content: note.content,
    createdAt: note.createdAt instanceof Date ? note.createdAt.toISOString() : new Date(note.createdAt).toISOString(),
    hiddenFromAgent: note.hiddenFromAgent,
    hiddenFromMc: note.hiddenFromMc
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
    })),
    daysInStatus,
    statusLastUpdated: referral.statusLastUpdated ? referral.statusLastUpdated.toISOString() : null,
    notes: filteredNotes,
    viewerRole
  };
}
