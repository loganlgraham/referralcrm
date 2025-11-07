import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { User } from '@/models/user';
import { getCurrentSession } from '@/lib/auth';

const updateAgentSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional(),
  coverageAreas: z.array(z.string().trim().min(1)).optional(),
  closings12mo: z.number().int().min(0).optional(),
  closingRatePercentage: z.number().min(0).max(100).nullable().optional(),
  npsScore: z.number().min(0).max(100).nullable().optional(),
  avgResponseHours: z.number().min(0).nullable().optional(),
});

interface Params {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = updateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const agent = await Agent.findById(params.id);
  if (!agent) {
    return new NextResponse('Not found', { status: 404 });
  }

  const isOwner = agent.userId?.toString() === session.user.id;
  const isAdmin = session.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const update: Record<string, unknown> = {};

  if (parsed.data.name !== undefined) {
    update.name = parsed.data.name;
  }
  if (parsed.data.email !== undefined) {
    update.email = parsed.data.email;
  }
  if (parsed.data.phone !== undefined) {
    update.phone = parsed.data.phone;
  }
  if (parsed.data.statesLicensed !== undefined) {
    update.statesLicensed = parsed.data.statesLicensed;
  }
  if (parsed.data.coverageAreas !== undefined) {
    update.zipCoverage = parsed.data.coverageAreas;
  }
  if (parsed.data.closings12mo !== undefined && isAdmin) {
    update.closings12mo = parsed.data.closings12mo;
  }
  if (parsed.data.closingRatePercentage !== undefined && isAdmin) {
    update.closingRatePercentage = parsed.data.closingRatePercentage;
  }
  if (parsed.data.npsScore !== undefined && isAdmin) {
    update.npsScore = parsed.data.npsScore;
  }
  if (parsed.data.avgResponseHours !== undefined && isAdmin) {
    update.avgResponseHours = parsed.data.avgResponseHours;
  }

  const updated = await Agent.findByIdAndUpdate(params.id, { $set: update }, { new: true }).lean();

  if (updated?.userId && (parsed.data.name !== undefined || parsed.data.email !== undefined)) {
    const userUpdate: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      userUpdate.name = parsed.data.name;
    }
    if (parsed.data.email !== undefined) {
      userUpdate.email = parsed.data.email;
    }
    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(updated.userId, { $set: userUpdate });
    }
  }

  return NextResponse.json({
    _id: updated?._id.toString(),
    name: updated?.name,
    email: updated?.email,
    phone: updated?.phone,
    statesLicensed: updated?.statesLicensed ?? [],
    coverageAreas: updated?.zipCoverage ?? [],
    closings12mo: updated?.closings12mo ?? 0,
    closingRatePercentage: updated?.closingRatePercentage ?? null,
    npsScore: updated?.npsScore ?? null,
    avgResponseHours: updated?.avgResponseHours ?? null,
  });
}
