import { NextRequest, NextResponse } from 'next/server';
import { Types } from 'mongoose';
import { z } from 'zod';

import { connectMongo } from '@/lib/mongoose';
import { Agent, AgentDocument } from '@/models/agent';
import { getCurrentSession } from '@/lib/auth';
import { computeAgentMetrics, EMPTY_AGENT_METRICS } from '@/lib/server/agent-metrics';
import { rememberCoverageSuggestions } from '@/lib/server/coverage-suggestions';
import {
  mergeAndNormalizeZipCodes,
  normalizeCoverageLocations,
  syncAgentZipCoverage,
} from '@/lib/server/zip-coverage';

const coverageLocationSchema = z.object({
  label: z.string().trim().min(1),
  zipCodes: z
    .array(z.string().trim().regex(/^\d{5}$/))
    .optional()
    .default([])
    .transform((zipCodes) => Array.from(new Set(zipCodes))),
});

const officeAddressSchema = z.object({
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  zipCode: z.string().trim().optional(),
});

const createAgentSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  phone: z.string().trim().optional(),
  licenseNumber: z.string().trim().optional(),
  brokerage: z.string().trim().optional(),
  officeAddress: officeAddressSchema.optional(),
  statesLicensed: z.array(z.string().trim().min(2)).optional().default([]),
  coverageAreas: z.array(z.string().trim().min(1)).optional().default([]),
  coverageLocations: z.array(coverageLocationSchema).optional().default([]),
  specialties: z.array(z.string().trim().min(1)).optional().default([]),
  languages: z.array(z.string().trim().min(1)).optional().default([]),
  ahaDesignation: z
    .enum(['AHA', 'AHA_OOS', 'AGIT'])
    .optional()
    .nullable()
    .default(null),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  
  const { searchParams } = new URL(request.url);
  const all = searchParams.get('all') === 'true';
  const page = Number(searchParams.get('page') || 1);
  const pageSizeParam = searchParams.get('pageSize');
  const validPageSizes = [20, 25, 50, 100];
  const pageSize = pageSizeParam && validPageSizes.includes(Number(pageSizeParam)) 
    ? Number(pageSizeParam) 
    : 25;
  const search = searchParams.get('search')?.trim() || null;
  const ahaFilter = searchParams.get('ahaFilter') || null;
  const sortBy = searchParams.get('sortBy')?.trim() || null;
  const sortDirection = (searchParams.get('sortDirection')?.trim() as 'asc' | 'desc') || 'desc';
  
  const filter: Record<string, unknown> = {};
  if (session.user.role !== 'admin') {
    filter.active = true;
  }
  
  // Add AHA filter if provided
  if (ahaFilter && (ahaFilter === 'AHA' || ahaFilter === 'AHA_OOS')) {
    filter.ahaDesignation = ahaFilter;
  }
  
  // Add search filter if provided
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizedDigits = search.replace(/\D/g, '');
    
    const searchConditions: Record<string, unknown>[] = [
      { name: new RegExp(escapedSearch, 'i') },
      { email: new RegExp(escapedSearch, 'i') },
      { phone: new RegExp(escapedSearch, 'i') },
      { brokerage: new RegExp(escapedSearch, 'i') },
      { licenseNumber: new RegExp(escapedSearch, 'i') }
    ];
    
    if (normalizedDigits) {
      searchConditions.push({ phone: new RegExp(normalizedDigits) });
    }
    
    filter.$or = searchConditions;
  }

  await connectMongo();

  /**
   * Maps client-side sort keys to MongoDB sort objects
   * Note: Some fields (closings, closingRate, etc.) are computed from metrics
   * and will need to be sorted after metrics computation
   */
  const getSortObject = (sortBy: string | null, sortDirection: 'asc' | 'desc'): Record<string, 1 | -1> | null => {
    const direction = sortDirection === 'asc' ? 1 : -1;
    
    if (!sortBy) {
      return null; // Use default (no explicit sort)
    }

    // Map client sort keys to MongoDB field paths (only for fields that exist in the database)
    const sortMap: Record<string, Record<string, 1 | -1>> = {
      name: { name: direction },
      nps: { npsScore: direction },
      // Note: closings, closingRate, avgResponse, referralFees, netIncome are computed from metrics
      // and will be sorted after metrics computation
    };

    return sortMap[sortBy] || null;
  };

  type AgentLean = {
    _id: Types.ObjectId;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    licenseNumber?: string | null;
    brokerage?: string | null;
    officeAddress?: {
      street?: string | null;
      city?: string | null;
      state?: string | null;
      zipCode?: string | null;
    } | null;
    statesLicensed?: string[] | null;
    zipCoverage?: string[] | null;
    coverageLocations?: {
      label: string;
      zipCodes: string[];
    }[] | null;
    npsScore?: number | null;
    specialties?: string[] | null;
    languages?: string[] | null;
    ahaDesignation?: 'AHA' | 'AHA_OOS' | 'AGIT' | null;
  };

  const sortObject = getSortObject(sortBy, sortDirection);
  const query = Agent.find(filter);
  if (sortObject) {
    query.sort(sortObject);
  }
  
  const [agents, total] = await Promise.all([
    all
      ? query.lean<AgentLean[]>()
      : query.skip((page - 1) * pageSize).limit(pageSize).lean<AgentLean[]>(),
    Agent.countDocuments(filter)
  ]);

  const agentIds = agents.map((agent) => agent._id);
  const npsScores = new Map<string, number | null>();
  agents.forEach((agent) => {
    const id = agent._id.toString();
    npsScores.set(id, agent.npsScore ?? null);
  });

  const metricsMap = await computeAgentMetrics(agentIds, npsScores);

  let payload = agents.map((agent) => {
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
      officeAddress: agent.officeAddress
        ? {
            street: agent.officeAddress.street ?? undefined,
            city: agent.officeAddress.city ?? undefined,
            state: agent.officeAddress.state ?? undefined,
            zipCode: agent.officeAddress.zipCode ?? undefined,
          }
        : undefined,
      statesLicensed: Array.isArray(agent.statesLicensed) ? agent.statesLicensed : [],
      coverageAreas: Array.isArray(agent.zipCoverage) ? agent.zipCoverage : [],
      coverageLocations: Array.isArray(agent.coverageLocations) ? agent.coverageLocations : [],
      specialties: Array.isArray(agent.specialties) ? agent.specialties : [],
      languages: Array.isArray(agent.languages) ? agent.languages : [],
      ahaDesignation:
        agent.ahaDesignation === 'AHA' || agent.ahaDesignation === 'AHA_OOS' || agent.ahaDesignation === 'AGIT'
          ? agent.ahaDesignation
          : null,
      metrics,
      npsScore: metrics.npsScore,
    };
  });

  // Sort by computed metrics fields if needed
  if (sortBy && ['closings', 'closingRate', 'avgResponse', 'referralFees', 'netIncome'].includes(sortBy)) {
    const direction = sortDirection === 'asc' ? 1 : -1;
    payload.sort((a, b) => {
      let aValue: number;
      let bValue: number;
      
      switch (sortBy) {
        case 'closings':
          aValue = a.metrics.closingsLast12Months;
          bValue = b.metrics.closingsLast12Months;
          break;
        case 'closingRate':
          aValue = a.metrics.closingRate;
          bValue = b.metrics.closingRate;
          break;
        case 'avgResponse':
          aValue = a.metrics.avgResponseHours ?? Infinity;
          bValue = b.metrics.avgResponseHours ?? Infinity;
          break;
        case 'referralFees':
          aValue = a.metrics.totalReferralFeesPaidCents;
          bValue = b.metrics.totalReferralFeesPaidCents;
          break;
        case 'netIncome':
          aValue = a.metrics.totalNetIncomeCents;
          bValue = b.metrics.totalNetIncomeCents;
          break;
        default:
          return 0;
      }
      
      return (aValue - bValue) * direction;
    });
  }

  return NextResponse.json({
    items: payload,
    total,
    page,
    pageSize
  });
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

  const normalizedCoverageLocations = normalizeCoverageLocations(
    parsed.data.coverageLocations
  );

  const combinedZipCoverage = mergeAndNormalizeZipCodes([
    ...parsed.data.coverageAreas,
    ...normalizedCoverageLocations.flatMap((location) => location.zipCodes),
  ]);

  let agent: AgentDocument;
  try {
    const officeAddress = parsed.data.officeAddress
      ? {
          street: parsed.data.officeAddress.street || undefined,
          city: parsed.data.officeAddress.city || undefined,
          state: parsed.data.officeAddress.state || undefined,
          zipCode: parsed.data.officeAddress.zipCode || undefined,
        }
      : undefined;
    const hasOfficeAddress = officeAddress && Object.values(officeAddress).some((value) => value !== undefined);

    agent = await Agent.create<AgentDocument>({
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? '',
      licenseNumber: parsed.data.licenseNumber ?? '',
      brokerage: parsed.data.brokerage ?? '',
      officeAddress: hasOfficeAddress ? officeAddress : undefined,
      statesLicensed: parsed.data.statesLicensed,
      zipCoverage: combinedZipCoverage,
      coverageLocations: normalizedCoverageLocations,
      specialties: parsed.data.specialties,
      languages: parsed.data.languages,
      ahaDesignation: parsed.data.ahaDesignation,
      active: true,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000) {
      return NextResponse.json(
        { message: 'An agent with this email already exists. Try updating their profile instead.' },
        { status: 409 }
      );
    }

    console.error('Failed to create agent', error);
    return NextResponse.json({ message: 'Unable to create agent' }, { status: 500 });
  }

  await syncAgentZipCoverage({
    agentId: agent._id,
    coverageLocations: normalizedCoverageLocations,
    explicitZipCodes: combinedZipCoverage,
  });

  const coverageSuggestionLabels = normalizedCoverageLocations.map(
    (location) => location.label
  );
  if (coverageSuggestionLabels.length > 0) {
    await rememberCoverageSuggestions(coverageSuggestionLabels);
  } else if (combinedZipCoverage.length > 0) {
    await rememberCoverageSuggestions(combinedZipCoverage);
  }

  return NextResponse.json({ id: agent._id.toString() }, { status: 201 });
}
