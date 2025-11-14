import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { isTransactionalEmailConfigured, sendTransactionalEmail } from '@/lib/email';
import { computeAgentMetrics, EMPTY_AGENT_METRICS } from '@/lib/server/agent-metrics';
import { rememberCoverageSuggestions } from '@/lib/server/coverage-suggestions';
import { mergeAndNormalizeZipCodes, syncAgentZipCoverage } from '@/lib/server/zip-coverage';

const coverageLocationSchema = z.object({
  label: z.string().trim().min(1),
  zipCodes: z
    .array(z.string().trim().regex(/^\d{5}$/))
    .min(1)
    .transform((zipCodes) => Array.from(new Set(zipCodes))),
});

const createAgentSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  licenseNumber: z.string().trim().optional(),
  brokerage: z.string().trim().optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional().default([]),
  coverageAreas: z.array(z.string().trim().min(1)).optional().default([]),
  coverageLocations: z.array(coverageLocationSchema).optional().default([]),
  specialties: z.array(z.string().trim().min(1)).optional().default([]),
  languages: z.array(z.string().trim().min(1)).optional().default([]),
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

  type AgentLean = {
    _id: Types.ObjectId;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    licenseNumber?: string | null;
    brokerage?: string | null;
    statesLicensed?: string[] | null;
    zipCoverage?: string[] | null;
    coverageLocations?: { label: string; zipCodes: string[] }[] | null;
    npsScore?: number | null;
    specialties?: string[] | null;
    languages?: string[] | null;
  };

  const agents = await Agent.find(filter).lean<AgentLean[]>();

  const agentIds = agents.map((agent) => agent._id);
  const npsScores = new Map<string, number | null>();
  agents.forEach((agent) => {
    const id = agent._id.toString();
    npsScores.set(id, agent.npsScore ?? null);
  });

  const metricsMap = await computeAgentMetrics(agentIds, npsScores);

  const payload = agents.map((agent) => {
    const id = agent._id.toString();
    const metrics = metricsMap.get(id) ?? {
      ...EMPTY_AGENT_METRICS,
      npsScore: agent.npsScore ?? null
    };
    return {
      _id: id,
      name: agent.name ?? '',
      email: agent.email ?? '',
      phone: agent.phone ?? '',
      licenseNumber: agent.licenseNumber ?? '',
      brokerage: agent.brokerage ?? '',
      statesLicensed: Array.isArray(agent.statesLicensed) ? agent.statesLicensed : [],
      coverageAreas: Array.isArray(agent.zipCoverage) ? agent.zipCoverage : [],
      coverageLocations: Array.isArray(agent.coverageLocations) ? agent.coverageLocations : [],
      specialties: Array.isArray(agent.specialties) ? agent.specialties : [],
      languages: Array.isArray(agent.languages) ? agent.languages : [],
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

  const combinedZipCoverage = mergeAndNormalizeZipCodes([
    ...parsed.data.coverageAreas,
    ...parsed.data.coverageLocations.flatMap((location) => location.zipCodes),
  ]);

  const agent = await Agent.create({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? '',
    licenseNumber: parsed.data.licenseNumber ?? '',
    brokerage: parsed.data.brokerage ?? '',
    statesLicensed: parsed.data.statesLicensed,
    zipCoverage: combinedZipCoverage,
    coverageLocations: parsed.data.coverageLocations,
    specialties: parsed.data.specialties,
    languages: parsed.data.languages,
    active: true,
  });

  await syncAgentZipCoverage({
    agentId: agent._id,
    coverageLocations: parsed.data.coverageLocations,
    explicitZipCodes: combinedZipCoverage,
  });

  const coverageSuggestionLabels = parsed.data.coverageLocations.map((location) => location.label);
  if (coverageSuggestionLabels.length > 0) {
    await rememberCoverageSuggestions(coverageSuggestionLabels);
  } else if (combinedZipCoverage.length > 0) {
    await rememberCoverageSuggestions(combinedZipCoverage);
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
