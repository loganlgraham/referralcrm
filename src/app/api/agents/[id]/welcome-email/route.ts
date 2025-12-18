import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';

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
  const agent = await Agent.findById(params.id);
  if (!agent) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (!agent.email) {
    return NextResponse.json({ error: 'Agent is missing an email address.' }, { status: 400 });
  }

  const inviteLink = `${baseUrl}/signup?role=agent&email=${encodeURIComponent(agent.email)}`;
  const agentFirstName = agent.name?.trim().split(/\s+/)[0] ?? agent.name ?? 'there';
  const html = `
    <p>Hi ${agentFirstName},</p>
    <p>You have been added to Referrio, American Home Agent's CRM. Please complete your profile and create your password so you can log in.</p>
    <p><a href="${inviteLink}">Finish your setup</a> to save your login and start collaborating with the team.</p>
    <p>We look forward to working with you!</p>
  `;
  const text = `Hi ${agentFirstName},

You have been added to Referrio, American Home Agent's CRM. Please complete your profile and create your password so you can log in.

Finish your setup: ${inviteLink}

We look forward to working with you!`;

  try {
    const delivered = await sendTransactionalEmail({
      to: [agent.email],
      subject: 'Welcome to Referral CRM — complete your profile',
      html,
      text,
    });

    if (!delivered) {
      return NextResponse.json({ error: 'Unable to send welcome email.' }, { status: 502 });
    }
  } catch (error) {
    console.error('Failed to deliver agent invite email', error);
    return NextResponse.json({ error: 'Unable to send welcome email.' }, { status: 500 });
  }

  return NextResponse.json({ delivered: true });
}
