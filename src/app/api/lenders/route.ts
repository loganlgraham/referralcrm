import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';
import { z } from 'zod';

const createLenderSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  nmlsId: z.string().trim().min(1),
  licensedStates: z.array(z.string().trim().min(2)).optional().default([]),
  team: z.string().trim().optional(),
  region: z.string().trim().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const filter: Record<string, unknown> = {};
  await connectMongo();
  const lenders = await LenderMC.find(filter).lean();
  return NextResponse.json(lenders);
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

  const lender = await LenderMC.create({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? '',
    nmlsId: parsed.data.nmlsId,
    licensedStates: parsed.data.licensedStates,
    team: parsed.data.team ?? '',
    region: parsed.data.region ?? '',
  });

  return NextResponse.json({ id: lender._id.toString() }, { status: 201 });
}
