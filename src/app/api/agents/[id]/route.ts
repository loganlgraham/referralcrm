import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { Agent } from '@/models/agent';
import { User } from '@/models/user';
import { getCurrentSession } from '@/lib/auth';
import { computeAgentMetrics, EMPTY_AGENT_METRICS } from '@/lib/server/agent-metrics';
import { rememberCoverageSuggestions } from '@/lib/server/coverage-suggestions';
import { mergeAndNormalizeZipCodes, syncAgentZipCoverage } from '@/lib/server/zip-coverage';
import { Referral } from '@/models/referral';

const coverageLocationSchema = z.object({
  label: z.string().trim().min(1),
  zipCodes: z
    .array(z.string().trim().regex(/^\d{5}$/))
    .min(1)
    .transform((zipCodes) => Array.from(new Set(zipCodes))),
});

const officeAddressSchema = z.object({
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  zipCode: z.string().trim().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().trim().min(1).optional(),
  email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().optional(),
  licenseNumber: z.string().trim().optional(),
  brokerage: z.string().trim().optional(),
  officeAddress: officeAddressSchema.optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional(),
  coverageAreas: z.array(z.string().trim().min(1)).optional(),
  coverageLocations: z.array(coverageLocationSchema).optional(),
  npsScore: z.number().min(-100).max(100).nullable().optional(),
  specialties: z.array(z.string().trim().min(1)).optional(),
  languages: z.array(z.string().trim().min(1)).optional(),
  ahaDesignation: z.enum(['AHA', 'AHA_OOS']).nullable().optional(),
});

interface Params {
  params: { id: string };
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = updateAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  await connectMongo();
  const agent = await Agent.findById(params.id);
  if (!agent) {
    return new NextResponse('Not found', { status: 404 });
  }

  const isOwner = agent.userId?.toString() === session.user.id;
  const isAdmin = session.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const update: Record<string, unknown> = {};

  // Copy simple fields that don't require special handling
  const simpleFields = [
    'name', 'email', 'phone', 'licenseNumber', 'brokerage',
    'statesLicensed', 'specialties', 'languages', 'ahaDesignation'
  ] as const;
  for (const field of simpleFields) {
    if (parsed.data[field] !== undefined) {
      update[field] = parsed.data[field];
    }
  }

  // Handle office address
  if (parsed.data.officeAddress !== undefined) {
    const officeAddress = {
      street: parsed.data.officeAddress.street || undefined,
      city: parsed.data.officeAddress.city || undefined,
      state: parsed.data.officeAddress.state || undefined,
      zipCode: parsed.data.officeAddress.zipCode || undefined,
    };
    const hasOfficeAddress = Object.values(officeAddress).some((value) => value !== undefined);
    update.officeAddress = hasOfficeAddress ? officeAddress : null;
  }

  // Handle coverage locations with ZIP normalization
  if (parsed.data.coverageLocations !== undefined) {
    const zippedFromLocations = parsed.data.coverageLocations.flatMap((loc) => loc.zipCodes);
    const zippedFromPayload = parsed.data.coverageAreas ?? [];
    update.coverageLocations = parsed.data.coverageLocations;
    update.zipCoverage = mergeAndNormalizeZipCodes([...zippedFromPayload, ...zippedFromLocations]);
  } else if (parsed.data.coverageAreas !== undefined) {
    update.zipCoverage = mergeAndNormalizeZipCodes(parsed.data.coverageAreas);
  }

  // NPS score requires admin
  if (parsed.data.npsScore !== undefined) {
    if (!isAdmin) {
      return new NextResponse('Forbidden', { status: 403 });
    }
    update.npsScore = parsed.data.npsScore;
  }

  const updated = await Agent.findByIdAndUpdate(params.id, { $set: update }, { new: true });

  if (!updated) {
    return new NextResponse('Not found', { status: 404 });
  }

  if (parsed.data.coverageLocations && parsed.data.coverageLocations.length > 0) {
    await rememberCoverageSuggestions(parsed.data.coverageLocations.map((location) => location.label));
  } else if (parsed.data.coverageAreas && parsed.data.coverageAreas.length > 0) {
    await rememberCoverageSuggestions(parsed.data.coverageAreas);
  }

  if (updated.userId && (parsed.data.name !== undefined || parsed.data.email !== undefined)) {
    const userUpdate: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) {
      userUpdate.name = parsed.data.name;
    }
    if (parsed.data.email !== undefined) {
      userUpdate.email = parsed.data.email;
    }
    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(updated.userId, { $set: userUpdate });
    }
  }

  await syncAgentZipCoverage({
    agentId: updated._id,
    coverageLocations: Array.isArray(updated.coverageLocations)
      ? updated.coverageLocations
      : [],
    explicitZipCodes: Array.isArray(updated.zipCoverage) ? updated.zipCoverage : [],
  });

  const metricsMap = await computeAgentMetrics([updated._id], new Map([[updated._id.toString(), updated.npsScore ?? null]]));
  const metrics = metricsMap.get(updated._id.toString()) ?? {
    ...EMPTY_AGENT_METRICS,
    npsScore: updated.npsScore ?? null
  };

  const updatedAgent = updated.toObject();

  return NextResponse.json({
    _id: updatedAgent._id.toString(),
    name: updatedAgent.name,
    email: updatedAgent.email,
    phone: updatedAgent.phone,
    licenseNumber: updatedAgent.licenseNumber ?? '',
    brokerage: updatedAgent.brokerage ?? '',
    officeAddress: updatedAgent.officeAddress
      ? {
          street: updatedAgent.officeAddress.street ?? undefined,
          city: updatedAgent.officeAddress.city ?? undefined,
          state: updatedAgent.officeAddress.state ?? undefined,
          zipCode: updatedAgent.officeAddress.zipCode ?? undefined,
        }
      : undefined,
    statesLicensed: updatedAgent.statesLicensed ?? [],
    coverageAreas: updatedAgent.zipCoverage ?? [],
    coverageLocations: Array.isArray(updatedAgent.coverageLocations) ? updatedAgent.coverageLocations : [],
    specialties: Array.isArray(updatedAgent.specialties) ? updatedAgent.specialties : [],
    languages: Array.isArray(updatedAgent.languages) ? updatedAgent.languages : [],
    ahaDesignation:
      updatedAgent.ahaDesignation === 'AHA' || updatedAgent.ahaDesignation === 'AHA_OOS'
        ? updatedAgent.ahaDesignation
        : null,
    metrics,
    npsScore: metrics.npsScore,
  });
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session || session.user.role !== 'admin') {
    return new NextResponse('Forbidden', { status: 403 });
  }

  await connectMongo();

  const agent = await Agent.findById(params.id);
  if (!agent) {
    return new NextResponse('Not found', { status: 404 });
  }

  await Referral.updateMany({ assignedAgent: agent._id }, { $unset: { assignedAgent: '' } });

  if (agent.userId) {
    await User.findByIdAndDelete(agent.userId);
  }

  await Agent.findByIdAndDelete(params.id);

  return new NextResponse(null, { status: 204 });
}
