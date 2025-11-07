import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { z } from 'zod';

const createAgentSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional().default([]),
  coverageAreas: z.array(z.string().trim().min(1)).optional().default([]),
  closings12mo: z.number().int().min(0).optional().default(0),
  closingRatePercentage: z.number().min(0).max(100).nullable().optional(),
  npsScore: z.number().min(0).max(100).nullable().optional(),
  avgResponseHours: z.number().min(0).nullable().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const filter: Record<string, unknown> = {};
  if (session.user.role !== 'admin') {
    filter.active = true;
  }

  await connectMongo();
  const agents = await Agent.find(filter).lean();
  return NextResponse.json(agents);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();

  const agent = await Agent.create({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? '',
    statesLicensed: parsed.data.statesLicensed,
    zipCoverage: parsed.data.coverageAreas,
    closings12mo: parsed.data.closings12mo,
    closingRatePercentage: parsed.data.closingRatePercentage ?? null,
    npsScore: parsed.data.npsScore ?? null,
    avgResponseHours: parsed.data.avgResponseHours ?? null,
    active: true,
  });

  return NextResponse.json({ id: agent._id.toString() }, { status: 201 });
}
