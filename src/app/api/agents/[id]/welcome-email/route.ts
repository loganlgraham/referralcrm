import { NextRequest, NextResponse } from 'next/server';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { renderAgentWelcomeEmail } from '@/lib/email-templates/invites';

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
  const { html, text } = renderAgentWelcomeEmail({ firstName: agentFirstName, inviteLink });

  try {
    const delivered = await sendTransactionalEmail({
      to: [agent.email],
      subject: 'American Home Agents Referral CRM – Get Started Now and start receiving referrals!',
      html,
      text,
    });

    if (!delivered) {
      return NextResponse.json({ error: 'Unable to send welcome email.' }, { status: 502 });
    }

    // Save timestamp when welcome email is successfully sent
    agent.welcomeEmailSentAt = new Date();
    await agent.save();
  } catch (error) {
    console.error('Failed to deliver agent invite email', error);
    return NextResponse.json({ error: 'Unable to send welcome email.' }, { status: 500 });
  }

  return NextResponse.json({ delivered: true });
}
