import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { User } from '@/models/user';
import { getCurrentSession } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { normalizePhoneNumber } from '@/utils/phone-utils';

const updateLenderSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().optional(),
  nmlsId: z.string().trim().optional(),
  licensedStates: z.array(z.string().trim().min(2)).optional(),
  active: z.boolean().optional(),
  includeInMetrics: z.boolean().optional(),
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

  // Check for duplicate email if email is being updated
  if (parsed.data.email !== undefined && parsed.data.email !== lender.email) {
    const existingLenderByEmail = await LenderMC.findOne({ 
      email: parsed.data.email,
      _id: { $ne: params.id }
    });
    if (existingLenderByEmail) {
      return NextResponse.json(
        { message: 'A mortgage consultant with this email already exists.' },
        { status: 409 }
      );
    }
  }

  // Check for duplicate phone if phone is being updated
  if (parsed.data.phone !== undefined && parsed.data.phone !== lender.phone) {
    const normalizedPhone = normalizePhoneNumber(parsed.data.phone);
    if (normalizedPhone) {
      // Find all lenders with phone numbers (excluding current lender) and check for normalized match
      // Optimize: Only fetch minimal fields needed for duplicate check
      const lendersWithPhones = await LenderMC.find({ 
        phone: { $exists: true, $ne: '' },
        _id: { $ne: params.id }
      })
        .select('phone _id name')
        .lean<{ _id: Types.ObjectId; phone: string; name?: string }[]>();
      const duplicateByPhone = lendersWithPhones.find((otherLender) => {
        const otherNormalizedPhone = normalizePhoneNumber(otherLender.phone);
        return otherNormalizedPhone === normalizedPhone;
      });
      
      if (duplicateByPhone) {
        return NextResponse.json(
          { message: 'A mortgage consultant with this phone number already exists.' },
          { status: 409 }
        );
      }
    }
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

  // Active and include-in-metrics flags require admin
  if (parsed.data.active !== undefined) {
    if (!isAdmin) {
      return new NextResponse('Forbidden', { status: 403 });
    }
    update.active = parsed.data.active;
  }
  if (parsed.data.includeInMetrics !== undefined) {
    if (!isAdmin) {
      return new NextResponse('Forbidden', { status: 403 });
    }
    update.includeInMetrics = parsed.data.includeInMetrics;
  }

  // An active mortgage consultant always counts toward dashboard leaderboards.
  if (update.active === true) {
    update.includeInMetrics = true;
  }

  const updated = await LenderMC.findByIdAndUpdate(params.id, { $set: update }, { new: true });

  if (!updated) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (updated.userId && (parsed.data.name !== undefined || parsed.data.email !== undefined)) {
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

  const updatedLender = updated.toObject();

  return NextResponse.json({
    _id: updatedLender._id.toString(),
    name: updatedLender.name,
    email: updatedLender.email,
    phone: updatedLender.phone,
    nmlsId: updatedLender.nmlsId,
    licensedStates: updatedLender.licensedStates ?? [],
    active: updatedLender.active !== false,
    includeInMetrics: updatedLender.includeInMetrics !== false,
  });
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();

  const lender = await LenderMC.findById(params.id);
  if (!lender) {
    return new NextResponse('Not found', { status: 404 });
  }

  await Referral.updateMany({ lender: lender._id }, { $unset: { lender: '' } });

  if (lender.userId) {
    await User.findByIdAndDelete(lender.userId);
  }

  await LenderMC.findByIdAndDelete(params.id);

  return new NextResponse(null, { status: 204 });
}
