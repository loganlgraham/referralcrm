import { NextRequest, NextResponse } from 'next/server';
import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { z } from 'zod';

const createLenderSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  nmlsId: z.string().trim().min(1),
  licensedStates: z.array(z.string().trim().min(2)).optional().default([]),
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
  });

  const baseUrl = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (baseUrl && isTransactionalEmailConfigured()) {
    const inviteLink = `${baseUrl}/signup?role=mortgage-consultant&email=${encodeURIComponent(lender.email)}`;
    const html = `
      <p>Hi ${lender.name},</p>
      <p>You have been invited to Referral CRM. Please complete your profile and choose a password to finish setting up your login.</p>
      <p><a href="${inviteLink}">Complete your profile</a> to save your credentials and start collaborating.</p>
      <p>If you were not expecting this invitation, please contact your admin.</p>
    `;
    const text = `Hi ${lender.name},

You have been invited to Referral CRM. Please complete your profile and choose a password to finish setting up your login.

Complete your profile: ${inviteLink}

If you were not expecting this invitation, please contact your admin.`;

    try {
      await sendTransactionalEmail({
        to: [lender.email],
        subject: 'Welcome to Referral CRM — complete your profile',
        html,
        text,
      });
    } catch (error) {
      console.error('Failed to deliver mortgage consultant invite email', error);
    }
  }

  return NextResponse.json({ id: lender._id.toString() }, { status: 201 });
}
