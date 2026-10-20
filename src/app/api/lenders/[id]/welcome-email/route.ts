import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { LenderMC } from '@/models/lender';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { renderMcWelcomeEmail } from '@/lib/email-templates/invites';

interface Params {
  params: { id: string };
}

export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  if (!isTransactionalEmailConfigured()) {
    return NextResponse.json({ error: 'Transactional email is not configured.' }, { status: 503 });
  }

  const baseUrl = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    return NextResponse.json({ error: 'Base URL is not configured.' }, { status: 503 });
  }

  await connectMongo();
  const lender = await LenderMC.findById(params.id);
  if (!lender) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (!lender.email) {
    return NextResponse.json({ error: 'Mortgage consultant is missing an email address.' }, { status: 400 });
  }

  const inviteLink = `${baseUrl}/signup?role=mortgage-consultant&email=${encodeURIComponent(lender.email)}`;
  const lenderFirstName = lender.name?.trim().split(/\s+/)[0] ?? lender.name ?? 'there';
  const { html, text } = renderMcWelcomeEmail({ firstName: lenderFirstName, inviteLink });

  try {
    const delivered = await sendTransactionalEmail({
      to: [lender.email],
      subject: 'Welcome to Referral CRM — complete your profile',
      html,
      text,
    });

    if (!delivered) {
      return NextResponse.json({ error: 'Unable to send welcome email.' }, { status: 502 });
    }
  } catch (error) {
    console.error('Failed to deliver mortgage consultant invite email', error);
    return NextResponse.json({ error: 'Unable to send welcome email.' }, { status: 500 });
  }

  return NextResponse.json({ delivered: true });
}
