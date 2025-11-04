import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Payment } from '@/models/payment';
import { paymentSchema } from '@/utils/validators';
import { getCurrentSession } from '@/lib/auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectMongo();
  const payments = await Payment.find().limit(100).lean();
  return NextResponse.json(payments);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json();
  const parsed = paymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const payment = await Payment.create({
    referralId: parsed.data.referralId,
    status: parsed.data.status,
    expectedAmountCents: parsed.data.expectedAmountCents,
    receivedAmountCents: parsed.data.receivedAmountCents,
    invoiceDate: parsed.data.invoiceDate,
    paidDate: parsed.data.paidDate,
    notes: parsed.data.notes
  });

  return NextResponse.json({ id: payment._id.toString() }, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  if (!['admin', 'manager'].includes(session.user.role)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const parsed = paymentSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const updatePayload: Record<string, unknown> = { ...parsed.data };
  delete updatePayload.referralId;
  const payment = await Payment.findByIdAndUpdate(body.id, updatePayload, { new: true });
  if (!payment) {
    return new NextResponse('Not found', { status: 404 });
  }

  return NextResponse.json({ id: payment._id.toString() });
}
