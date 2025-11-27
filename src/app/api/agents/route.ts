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
import { geocodeCoverageLabel, GeocodingError } from '@/lib/server/google-geocoding';

const geoPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const geoBoundsSchema = z.object({
  northeast: geoPointSchema,
  southwest: geoPointSchema,
});

const coverageLocationSchema = z.object({
  label: z.string().trim().min(1),
  zipCodes: z
    .array(z.string().trim().regex(/^\d{5}$/))
    .optional()
    .default([])
    .transform((zipCodes) => Array.from(new Set(zipCodes))),
  center: geoPointSchema.optional(),
  viewport: geoBoundsSchema.optional(),
  bounds: geoBoundsSchema.optional(),
  placeId: z.string().trim().optional(),
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
  ahaDesignation: z
    .enum(['AHA', 'AHA_OOS'])
    .optional()
    .nullable()
    .default(null),
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
    coverageLocations?: {
      label: string;
      zipCodes: string[];
      center?: { lat: number; lng: number };
      viewport?: {
        northeast: { lat: number; lng: number };
        southwest: { lat: number; lng: number };
      } | null;
      bounds?: {
        northeast: { lat: number; lng: number };
        southwest: { lat: number; lng: number };
      } | null;
      placeId?: string | null;
    }[] | null;
    npsScore?: number | null;
    specialties?: string[] | null;
    languages?: string[] | null;
    ahaDesignation?: 'AHA' | 'AHA_OOS' | null;
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
      ahaDesignation:
        agent.ahaDesignation === 'AHA' || agent.ahaDesignation === 'AHA_OOS'
          ? agent.ahaDesignation
          : null,
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

  const resolveCoverageLocation = async (location: z.infer<typeof coverageLocationSchema>) => {
    const baseZipCodes = mergeAndNormalizeZipCodes(location.zipCodes ?? []);

    if (location.center) {
      if (baseZipCodes.length === 0) {
        throw new GeocodingError('Coverage locations must include at least one ZIP code', 'ZERO_RESULTS');
      }

      return {
        label: location.label,
        zipCodes: baseZipCodes,
        center: location.center,
        viewport: location.viewport,
        bounds: location.bounds,
        placeId: location.placeId,
      };
    }

    const result = await geocodeCoverageLabel(location.label);
    const postalCodes = mergeAndNormalizeZipCodes([...baseZipCodes, ...result.postalCodes]);

    if (postalCodes.length === 0) {
      throw new GeocodingError('No postal codes found for location', 'ZERO_RESULTS');
    }

    return {
      label: result.formattedAddress || location.label,
      zipCodes: postalCodes,
      center: result.center,
      viewport: result.viewport,
      bounds: result.bounds,
      placeId: result.placeId ?? location.placeId,
    };
  };

  let geocodedLocations: Awaited<ReturnType<typeof resolveCoverageLocation>>[];
  try {
    geocodedLocations = await Promise.all(
      parsed.data.coverageLocations.map(async (location) => {
        try {
          return await resolveCoverageLocation(location);
        } catch (error) {
          if (error instanceof GeocodingError) {
            throw error;
          }
          throw new GeocodingError('Failed to resolve coverage location');
        }
      })
    );
  } catch (error) {
    if (error instanceof GeocodingError) {
      const statusCode = error.status === 'OVER_QUERY_LIMIT' ? 503 : 422;
      return NextResponse.json({ error: error.message }, { status: statusCode });
    }
    return NextResponse.json({ error: 'Failed to geocode coverage locations' }, { status: 500 });
  }

  const combinedZipCoverage = mergeAndNormalizeZipCodes([
    ...parsed.data.coverageAreas,
    ...geocodedLocations.flatMap((location) => location.zipCodes),
  ]);

  const agent = await Agent.create({
    name: parsed.data.name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? '',
    licenseNumber: parsed.data.licenseNumber ?? '',
    brokerage: parsed.data.brokerage ?? '',
    statesLicensed: parsed.data.statesLicensed,
    zipCoverage: combinedZipCoverage,
    coverageLocations: geocodedLocations,
    specialties: parsed.data.specialties,
    languages: parsed.data.languages,
    ahaDesignation: parsed.data.ahaDesignation,
    active: true,
  });

  await syncAgentZipCoverage({
    agentId: agent._id,
    coverageLocations: geocodedLocations,
    explicitZipCodes: combinedZipCoverage,
  });

  const coverageSuggestionLabels = geocodedLocations.map((location) => location.label);
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
      <p>You have been added to Referral CRM. Please complete your profile and create your password so you can log in.</p>
      <p><a href="${inviteLink}">Finish your setup</a> to save your login and start collaborating with the team.</p>
      <p>If you were not expecting this invitation, please contact your admin.</p>
    `;
    const text = `Hi ${agent.name},

You have been added to Referral CRM. Please complete your profile and create your password so you can log in.

Finish your setup: ${inviteLink}

If you were not expecting this invitation, please contact your admin.`;

    try {
      await sendTransactionalEmail({
        to: [agent.email],
        subject: 'Welcome to Referral CRM — complete your profile',
        html,
        text,
      });
    } catch (error) {
      console.error('Failed to deliver agent invite email', error);
    }
  }

  return NextResponse.json({ id: agent._id.toString() }, { status: 201 });
}
