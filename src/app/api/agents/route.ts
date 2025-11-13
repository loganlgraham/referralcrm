import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { computeAgentMetrics, EMPTY_AGENT_METRICS } from '@/lib/server/agent-metrics';
import { rememberCoverageSuggestions } from '@/lib/server/coverage-suggestions';

const createAgentSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  licenseNumber: z.string().trim().optional(),
  brokerage: z.string().trim().optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional().default([]),
  coverageAreas: z.array(z.string().trim().min(1)).optional().default([]),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const filter: Record<string, unknown> = {};
  if (session.user.role !== 'admin') {
    filter.active = true;
  }

  await connectMongo();
  const agents = await Agent.find(filter).lean();

  const agentIds = agents.map((agent) => agent._id);
  const npsScores = new Map<string, number | null>();
  agents.forEach((agent) => {
    npsScores.set(agent._id.toString(), agent.npsScore ?? null);
  });

  const metricsMap = await computeAgentMetrics(agentIds, npsScores);

  const payload = agents.map((agent) => {
    const metrics = metricsMap.get(agent._id.toString()) ?? {
      ...EMPTY_AGENT_METRICS,
      npsScore: agent.npsScore ?? null
    };
    return {
      _id: agent._id.toString(),
      name: agent.name ?? '',
      email: agent.email ?? '',
      phone: agent.phone ?? '',
      licenseNumber: agent.licenseNumber ?? '',
      brokerage: agent.brokerage ?? '',
      statesLicensed: Array.isArray(agent.statesLicensed) ? agent.statesLicensed : [],
      coverageAreas: Array.isArray(agent.zipCoverage) ? agent.zipCoverage : [],
      metrics,
      npsScore: metrics.npsScore,
    };
  });

  return NextResponse.json(payload);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();

  const agent = await Agent.create({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? '',
    licenseNumber: parsed.data.licenseNumber ?? '',
    brokerage: parsed.data.brokerage ?? '',
    statesLicensed: parsed.data.statesLicensed,
    zipCoverage: parsed.data.coverageAreas,
    active: true,
  });

  if (parsed.data.coverageAreas.length > 0) {
    await rememberCoverageSuggestions(parsed.data.coverageAreas);
  }

  const baseUrl = (process.env.NEXTAUTH_URL || process.env.APP_URL || '').replace(/\/$/, '');
  if (baseUrl && isTransactionalEmailConfigured()) {
    const inviteLink = `${baseUrl}/signup?role=agent&email=${encodeURIComponent(agent.email)}`;
    const html = `
      <p>Hi ${agent.name},</p>
      <p>You have been added to the Referral CRM platform. Create your login to track referrals, view performance metrics, and collaborate with the team.</p>
      <p><a href="${inviteLink}">Create your account</a> to set your password and finish onboarding.</p>
      <p>If you were not expecting this invitation, please contact your admin.</p>
    `;
    const text = `Hi ${agent.name},

You have been added to the Referral CRM platform. Create your login to track referrals, view performance metrics, and collaborate with the team.

Create your account: ${inviteLink}

If you were not expecting this invitation, please contact your admin.`;

    try {
      await sendTransactionalEmail({
        to: [agent.email],
        subject: 'Welcome to Referral CRM — create your login',
        html,
        text,
      });
    } catch (error) {
      console.error('Failed to deliver agent invite email', error);
    }
  }

  return NextResponse.json({ id: agent._id.toString() }, { status: 201 });
}
