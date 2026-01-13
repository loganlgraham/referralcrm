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
    <p>You've been added to Referrio, our private, custom referral CRM for American Home Agents' out-of-state partners.</p>
    <p>We built this to make referrals easier—not more work. It's a simple, secure place to see your assigned referrals, leave quick updates, and stay aligned with the mortgage consultant without extra emails or check-ins.</p>
    <p>Once you complete your profile and create your password, you'll be able to:</p>
    <ul>
      <li>View your referrals in one place</li>
      <li>Drop quick updates as things move forward</li>
      <li>Track progress and communicate with the team</li>
    </ul>
    <p>This CRM is exclusively for our American Home Agents referral partners and American Financing and is only visible to you and the involved team.</p>
    <p>Thanks for collaborating with American Home Agents—we're excited to work together and provide great service to our referred clients. Let us know if you have any questions or need help getting set up.</p>
    <p><a href="${inviteLink}">Complete your profile and create your password</a></p>
  `;
  const text = `Hi ${agentFirstName},

You've been added to Referrio, our private, custom referral CRM for American Home Agents' out-of-state partners.

We built this to make referrals easier—not more work. It's a simple, secure place to see your assigned referrals, leave quick updates, and stay aligned with the mortgage consultant without extra emails or check-ins.

Once you complete your profile and create your password, you'll be able to:

• View your referrals in one place
• Drop quick updates as things move forward
• Track progress and communicate with the team

This CRM is exclusively for our American Home Agents referral partners and American Financing and is only visible to you and the involved team.

Thanks for collaborating with American Home Agents—we're excited to work together and provide great service to our referred clients. Let us know if you have any questions or need help getting set up.

Complete your profile and create your password: ${inviteLink}`;

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
