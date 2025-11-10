import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentSession } from '@/lib/auth';
import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { LenderMC } from '@/models/lender';
import { User } from '@/models/user';

const agentProfileSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional().default([]),
  coverageAreas: z.array(z.string().trim().min(1)).optional().default([]),
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
      .select('name email phone statesLicensed zipCoverage');
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
      statesLicensed: agentData.statesLicensed ?? [],
      coverageAreas: agentData.zipCoverage ?? [],
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
    agent.zipCoverage = parsed.data.coverageAreas;
    await agent.save();

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
      statesLicensed: agent.statesLicensed,
      coverageAreas: agent.zipCoverage,
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
