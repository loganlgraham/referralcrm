import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { User } from '@/models/user';
import { getCurrentSession } from '@/lib/auth';

const updateLenderSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().optional(),
  nmlsId: z.string().trim().optional(),
  licensedStates: z.array(z.string().trim().min(2)).optional(),
  team: z.string().trim().optional(),
  region: z.string().trim().optional(),
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
  const parsed = updateLenderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const lender = await LenderMC.findById(params.id);
  if (!lender) {
    return new NextResponse('Not found', { status: 404 });
  }

  const isOwner = lender.userId?.toString() === session.user.id;
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
  if (parsed.data.nmlsId !== undefined) {
    update.nmlsId = parsed.data.nmlsId;
  }
  if (parsed.data.licensedStates !== undefined) {
    update.licensedStates = parsed.data.licensedStates;
  }
  if (parsed.data.team !== undefined) {
    update.team = parsed.data.team;
  }
  if (parsed.data.region !== undefined) {
    update.region = parsed.data.region;
  }

  const updated = await LenderMC.findByIdAndUpdate(params.id, { $set: update }, { new: true }).lean();

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
    nmlsId: updated?.nmlsId,
    licensedStates: updated?.licensedStates ?? [],
    team: updated?.team ?? '',
    region: updated?.region ?? '',
  });
}
