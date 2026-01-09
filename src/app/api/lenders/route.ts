import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';
import { z } from 'zod';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';
import { Types } from 'mongoose';
import { subYears } from 'date-fns';
import { normalizePhoneNumber } from '@/utils/phone-utils';

const createLenderSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  nmlsId: z.string().trim().optional().default(''),
  licensedStates: z.array(z.string().trim().min(2)).optional().default([]),
});

const CLOSED_PAYMENT_STATUSES = new Set(['closed', 'payment_sent', 'paid']);

const EMPTY_LENDER_METRICS = {
  closingsLast12Months: 0,
  closingRate: 0,
  totalReferrals: 0,
  activePipeline: 0,
  dealsClosedAllTime: 0,
  revenueRealizedCents: 0,
  npsScore: null as number | null,
};

async function computeLenderMetrics(lenderIds: Types.ObjectId[]) {
  if (lenderIds.length === 0) {
    return new Map<string, typeof EMPTY_LENDER_METRICS>();
  }

  const referrals = await Referral.find({ lender: { $in: lenderIds }, deletedAt: null })
    .select('_id lender status createdAt')
    .lean<{ _id: Types.ObjectId; lender?: Types.ObjectId; status?: string | null; createdAt?: Date | null }[]>();

  const referralIds = referrals.map((referral) => referral._id).filter((value): value is Types.ObjectId => Types.ObjectId.isValid(value));

  const payments = referralIds.length
    ? await Payment.find({ referralId: { $in: referralIds } })
        .populate('referralId', 'lender status')
        .lean<
          Array<
            {
              status?: string | null;
              receivedAmountCents?: number | null;
              paidDate?: Date | null;
              invoiceDate?: Date | null;
              updatedAt?: Date | null;
              createdAt?: Date | null;
              referralId?: { lender?: Types.ObjectId; status?: string | null } | Types.ObjectId | null;
            }
          >
        >()
    : [];

  const referralMap = new Map<string, { status?: string | null; createdAt?: Date | null }[]>();
  referrals.forEach((referral) => {
    const lenderId = referral.lender?.toString();
    if (!lenderId) return;
    const bucket = referralMap.get(lenderId) ?? [];
    bucket.push({ status: referral.status, createdAt: referral.createdAt ?? null });
    referralMap.set(lenderId, bucket);
  });

  const paymentMap = new Map<string, typeof payments>();
  payments.forEach((payment) => {
    const lenderId = (() => {
      const referralField = payment.referralId;
      if (referralField && typeof referralField === 'object' && 'lender' in referralField) {
        const nested = referralField.lender;
        return nested instanceof Types.ObjectId ? nested.toString() : typeof nested === 'string' ? nested : null;
      }
      return null;
    })();

    if (!lenderId) return;
    const bucket = paymentMap.get(lenderId) ?? [];
    bucket.push(payment);
    paymentMap.set(lenderId, bucket);
  });

  const lastYear = subYears(new Date(), 1);
  const metricsByLender = new Map<string, typeof EMPTY_LENDER_METRICS>();

  lenderIds.forEach((idValue) => {
    const id = idValue.toString();
    const lenderReferrals = referralMap.get(id) ?? [];
    const lenderPayments = paymentMap.get(id) ?? [];

    if (!lenderReferrals.length && !lenderPayments.length) {
      metricsByLender.set(id, { ...EMPTY_LENDER_METRICS });
      return;
    }

    const totalReferrals = lenderReferrals.length;
    const activePipeline = lenderReferrals.filter((referral) => {
      const status = (referral.status ?? '').trim();
      return !['Closed', 'Lost', 'Terminated'].includes(status);
    }).length;

    const closedPayments = lenderPayments.filter((payment) => CLOSED_PAYMENT_STATUSES.has((payment.status ?? '').trim()));
    const dealsClosedAllTime = closedPayments.length;
    const closingRate = totalReferrals === 0 ? 0 : (dealsClosedAllTime / totalReferrals) * 100;

    let closingsLast12Months = 0;
    let revenueRealizedCents = 0;

    closedPayments.forEach((payment) => {
      const paidDate = payment.paidDate || payment.invoiceDate || payment.updatedAt || payment.createdAt || new Date();
      if (paidDate >= lastYear) {
        closingsLast12Months += 1;
      }
      if (payment.status === 'paid') {
        revenueRealizedCents += payment.receivedAmountCents ?? 0;
      }
    });

    metricsByLender.set(id, {
      closingsLast12Months,
      closingRate,
      totalReferrals,
      activePipeline,
      dealsClosedAllTime,
      revenueRealizedCents,
      npsScore: null,
    });
  });

  return metricsByLender;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  
  const { searchParams } = new URL(request.url);
  const all = searchParams.get('all') === 'true';
  const page = Number(searchParams.get('page') || 1);
  const pageSizeParam = searchParams.get('pageSize');
  const validPageSizes = [20, 25, 50, 100];
  const pageSize = pageSizeParam && validPageSizes.includes(Number(pageSizeParam)) 
    ? Number(pageSizeParam) 
    : 25;
  const search = searchParams.get('search')?.trim() || null;
  
  const filter: Record<string, unknown> = {};
  
  // Add search filter if provided
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizedDigits = search.replace(/\D/g, '');
    
    const searchConditions: Record<string, unknown>[] = [
      { name: new RegExp(escapedSearch, 'i') },
      { email: new RegExp(escapedSearch, 'i') },
      { phone: new RegExp(escapedSearch, 'i') },
      { nmlsId: new RegExp(escapedSearch, 'i') }
    ];
    
    if (normalizedDigits) {
      searchConditions.push(
        { phone: new RegExp(normalizedDigits) },
        { nmlsId: new RegExp(normalizedDigits) }
      );
    }
    
    filter.$or = searchConditions;
  }
  
  await connectMongo();
  const query = LenderMC.find(filter);
  const [lenders, total] = await Promise.all([
    all
      ? query.lean<{
          _id: Types.ObjectId | string;
          name?: string;
          email?: string;
          phone?: string;
          nmlsId?: string;
          licensedStates?: string[];
          team?: string;
          region?: string;
          notes?: unknown[];
          userId?: Types.ObjectId | string | null;
          createdAt?: Date;
          updatedAt?: Date;
        }[]>()
      : query.skip((page - 1) * pageSize).limit(pageSize).lean<{
          _id: Types.ObjectId | string;
          name?: string;
          email?: string;
          phone?: string;
          nmlsId?: string;
          licensedStates?: string[];
          team?: string;
          region?: string;
          notes?: unknown[];
          userId?: Types.ObjectId | string | null;
          createdAt?: Date;
          updatedAt?: Date;
        }[]>(),
    LenderMC.countDocuments(filter)
  ]);

  const lenderIds = lenders
    .map((lender) => {
      const value = lender._id;
      if (!Types.ObjectId.isValid(value)) return null;
      return typeof value === 'string' ? new Types.ObjectId(value) : value;
    })
    .filter((value): value is Types.ObjectId => value !== null);
  const metrics = await computeLenderMetrics(lenderIds);

  const response = lenders.map((lender) => {
    const id = lender._id?.toString?.() ?? '';
    return {
      ...lender,
      _id: id,
      metrics: metrics.get(id) ?? EMPTY_LENDER_METRICS,
    };
  });

  return NextResponse.json({
    items: response,
    total,
    page,
    pageSize
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = createLenderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();

  // Check for duplicate email
  const existingLenderByEmail = await LenderMC.findOne({ email: parsed.data.email });
  if (existingLenderByEmail) {
    return NextResponse.json(
      { message: 'A mortgage consultant with this email already exists. Try updating their profile instead.' },
      { status: 409 }
    );
  }

  // Check for duplicate phone number (if provided)
  if (parsed.data.phone) {
    const normalizedPhone = normalizePhoneNumber(parsed.data.phone);
    if (normalizedPhone) {
      // Find all lenders with phone numbers and check for normalized match
      const lendersWithPhones = await LenderMC.find({ phone: { $exists: true, $ne: '' } });
      const duplicateByPhone = lendersWithPhones.find((lender) => {
        const lenderNormalizedPhone = normalizePhoneNumber(lender.phone);
        return lenderNormalizedPhone === normalizedPhone;
      });
      
      if (duplicateByPhone) {
        return NextResponse.json(
          { message: 'A mortgage consultant with this phone number already exists. Try updating their profile instead.' },
          { status: 409 }
        );
      }
    }
  }

  const lender = await LenderMC.create({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? '',
    nmlsId: parsed.data.nmlsId ?? '',
    licensedStates: parsed.data.licensedStates,
  });

  return NextResponse.json({ id: lender._id.toString() }, { status: 201 });
}
