import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseISO } from 'date-fns';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { User } from '@/models/user';
import { rememberCoverageSuggestions } from '@/lib/server/coverage-suggestions';
import { mergeAndNormalizeZipCodes, syncAgentZipCoverage } from '@/lib/server/zip-coverage';

const coverageLocationSchema = z.object({
  label: z.string().trim().min(1),
  zipCodes: z
    .array(z.string().trim().regex(/^\d{5}$/))
    .min(1)
    .transform((zipCodes) => Array.from(new Set(zipCodes))),
});

const agentProfileSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  licenseNumber: z.string().trim().optional(),
  brokerage: z.string().trim().optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional().default([]),
  coverageAreas: z.array(z.string().trim().min(1)).optional().default([]),
  coverageLocations: z.array(coverageLocationSchema).optional().default([]),
  markets: z.array(z.string().trim().min(1)).optional().default([]),
  experienceSince: z.string().trim().optional().nullable(),
  specialties: z.array(z.string().trim().min(1)).optional().default([]),
  languages: z.array(z.string().trim().min(1)).optional().default([]),
});

const lenderProfileSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  licensedStates: z.array(z.string().trim().min(2)).optional().default([]),
});

export async function GET(): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await connectMongo();

  if (session.user.role === 'agent') {
    const agent = await Agent.findOne({ $or: [{ userId: session.user.id }, { email: session.user.email }] })
      .select(
        'name email phone statesLicensed zipCoverage coverageLocations licenseNumber brokerage markets experienceSince specialties languages'
      );
    if (!agent) {
      return new NextResponse('Not found', { status: 404 });
    }
    const agentData = agent.toObject();
    return NextResponse.json({
      role: 'agent',
      _id: agentData._id.toString(),
      name: agentData.name,
      email: agentData.email,
      phone: agentData.phone ?? '',
      licenseNumber: agentData.licenseNumber ?? '',
      brokerage: agentData.brokerage ?? '',
      statesLicensed: agentData.statesLicensed ?? [],
      coverageAreas: agentData.zipCoverage ?? [],
      coverageLocations: agentData.coverageLocations ?? [],
      markets: agentData.markets ?? [],
      experienceSince:
        agentData.experienceSince instanceof Date ? agentData.experienceSince.toISOString() : null,
      specialties: Array.isArray(agentData.specialties) ? agentData.specialties : [],
      languages: Array.isArray(agentData.languages) ? agentData.languages : [],
    });
  }

  if (session.user.role === 'mc') {
    const lender = await LenderMC.findOne({ $or: [{ userId: session.user.id }, { email: session.user.email }] })
      .select('name email phone licensedStates nmlsId');
    if (!lender) {
      return new NextResponse('Not found', { status: 404 });
    }
    const lenderData = lender.toObject();
    return NextResponse.json({
      role: 'mc',
      _id: lenderData._id.toString(),
      name: lenderData.name,
      email: lenderData.email,
      phone: lenderData.phone ?? '',
      nmlsId: lenderData.nmlsId ?? '',
      licensedStates: lenderData.licensedStates ?? [],
    });
  }

  return NextResponse.json({
    role: session.user.role,
    name: session.user.name,
    email: session.user.email,
  });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  await connectMongo();

  if (session.user.role === 'agent') {
    const agent = await Agent.findOne({ $or: [{ userId: session.user.id }, { email: session.user.email }] });
    if (!agent) {
      return new NextResponse('Not found', { status: 404 });
    }

    const parsed = agentProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
    }

    agent.name = parsed.data.name;
    agent.email = parsed.data.email;
    agent.phone = parsed.data.phone ?? '';
    agent.statesLicensed = parsed.data.statesLicensed;
    const coverageLocations = parsed.data.coverageLocations;
    const coverageAreas = parsed.data.coverageAreas;
    const combinedZipCoverage = mergeAndNormalizeZipCodes([
      ...coverageAreas,
      ...coverageLocations.flatMap((location) => location.zipCodes),
    ]);
    agent.zipCoverage = combinedZipCoverage;
    agent.coverageLocations = coverageLocations;
    agent.markets = parsed.data.markets;
    agent.licenseNumber = parsed.data.licenseNumber ?? '';
    agent.brokerage = parsed.data.brokerage ?? '';
    agent.specialties = parsed.data.specialties ?? [];
    agent.languages = parsed.data.languages ?? [];
    if (parsed.data.experienceSince) {
      const experienceDate = parseISO(parsed.data.experienceSince);
      if (Number.isNaN(experienceDate.getTime())) {
        return NextResponse.json({ error: { experienceSince: ['Experience start date is invalid.'] } }, { status: 422 });
      }
      agent.experienceSince = experienceDate;
    } else {
      agent.experienceSince = null;
    }
    await agent.save();
    await syncAgentZipCoverage({
      agentId: agent._id,
      coverageLocations,
      explicitZipCodes: combinedZipCoverage,
    });

    const coverageSuggestionLabels = coverageLocations.map((location) => location.label);
    if (coverageSuggestionLabels.length > 0) {
      await rememberCoverageSuggestions(coverageSuggestionLabels);
    } else if (combinedZipCoverage.length > 0) {
      await rememberCoverageSuggestions(combinedZipCoverage);
    }

    if (agent.userId) {
      await User.findByIdAndUpdate(agent.userId, {
        $set: { name: parsed.data.name, email: parsed.data.email },
      });
    }

    return NextResponse.json({
      role: 'agent',
      _id: agent._id.toString(),
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      licenseNumber: agent.licenseNumber ?? '',
      brokerage: agent.brokerage ?? '',
      statesLicensed: agent.statesLicensed,
      coverageAreas: agent.zipCoverage,
      coverageLocations: agent.coverageLocations ?? [],
      markets: agent.markets ?? [],
      experienceSince: agent.experienceSince instanceof Date ? agent.experienceSince.toISOString() : null,
      specialties: Array.isArray(agent.specialties) ? agent.specialties : [],
      languages: Array.isArray(agent.languages) ? agent.languages : [],
    });
  }

  if (session.user.role === 'mc') {
    const lender = await LenderMC.findOne({ $or: [{ userId: session.user.id }, { email: session.user.email }] });
    if (!lender) {
      return new NextResponse('Not found', { status: 404 });
    }

    const parsed = lenderProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
    }

    lender.name = parsed.data.name;
    lender.email = parsed.data.email;
    lender.phone = parsed.data.phone ?? '';
    lender.licensedStates = parsed.data.licensedStates;
    await lender.save();

    if (lender.userId) {
      await User.findByIdAndUpdate(lender.userId, {
        $set: { name: parsed.data.name, email: parsed.data.email },
      });
    }

    return NextResponse.json({
      role: 'mc',
      _id: lender._id.toString(),
      name: lender.name,
      email: lender.email,
      phone: lender.phone,
      licensedStates: lender.licensedStates,
    });
  }

  return new NextResponse('Unsupported', { status: 400 });
}
