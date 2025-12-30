import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { NPSToken } from '@/models/nps-token';
import { updateNPSScore } from '@/lib/server/nps';

const submitSchema = z.object({
  token: z.string().min(1),
  score: z.number().int().min(0).max(10),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const json = await request.json().catch(() => null);
  const parsed = submitSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  await connectMongo();

  const { token, score } = parsed.data;

  // Find and validate token
  const npsToken = await NPSToken.findOne({ token })
    .lean<{
      _id?: any;
      type?: 'lender' | 'agent';
      submitted?: boolean;
      expiresAt?: Date;
      targetId?: any;
    } | null>();

  if (!npsToken || !npsToken._id) {
    return NextResponse.json({ error: 'Invalid survey link' }, { status: 404 });
  }

  if (npsToken.submitted) {
    return NextResponse.json({ error: 'Survey already submitted' }, { status: 400 });
  }

  if (npsToken.expiresAt && new Date() > new Date(npsToken.expiresAt)) {
    return NextResponse.json({ error: 'Survey link has expired' }, { status: 400 });
  }

  if (!npsToken.type || !npsToken.targetId) {
    return NextResponse.json({ error: 'Invalid survey link' }, { status: 400 });
  }

  // Update token
  await NPSToken.findByIdAndUpdate(npsToken._id, {
    submitted: true,
    score,
    submittedAt: new Date(),
  });

  // Update NPS score for agent or lender
  await updateNPSScore(npsToken.type, npsToken.targetId.toString(), score);

  return NextResponse.json({ success: true });
}

