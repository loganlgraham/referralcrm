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
      referralId?: any;
      targetId?: any;
      recipientName?: string;
      submitted?: boolean;
      expiresAt?: Date;
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

  // Create admin notification for survey completion
  const { Referral } = await import('@/models/referral');
  const { Agent } = await import('@/models/agent');
  const { LenderMC } = await import('@/models/lender');
  const referral = await Referral.findById(npsToken.referralId)
    .select('borrower')
    .lean<{ borrower?: { name?: string } }>();

  let targetName = 'Unknown';
  if (npsToken.type === 'agent') {
    const agentDoc = await Agent.findById(npsToken.targetId)
      .select('name')
      .lean<{ name?: string }>();
    targetName = agentDoc?.name || 'Agent';
  } else {
    const lenderDoc = await LenderMC.findById(npsToken.targetId)
      .select('name')
      .lean<{ name?: string }>();
    targetName = lenderDoc?.name || 'Mortgage Consultant';
  }

  const borrowerName = referral?.borrower?.name || 'Unknown';
  const surveyType = npsToken.type === 'agent' ? 'Agent' : 'Lender';

  const { createAdminNotifications } = await import('@/lib/server/notifications');
  await createAdminNotifications({
    type: 'nps_survey_completed',
    referralId: npsToken.referralId.toString(),
    borrowerName,
    actorRole: npsToken.recipientName ?? 'Survey respondent',
    actorName: targetName,
    content: `${surveyType} ${targetName} received NPS score: ${score}/10`,
  });

  return NextResponse.json({ success: true });
}

