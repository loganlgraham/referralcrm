import { NextResponse } from 'next/server';
import { z } from 'zod';

import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { canManageReferral } from '@/lib/rbac';
import { expandZipCodesBy25Miles } from '@/utils/location';

interface Params {
  params: { id: string };
}

type CandidateAgent = {
  _id: Types.ObjectId | string;
  name: string;
  zipCoverage?: string[] | null;
  coverageLocations?: string[] | null;
  specialties?: string[] | null;
  languages?: string[] | null;
  ahaDesignation?: string | null;
  closingRatePercentage?: number | null;
  npsScore?: number | null;
};

const CLOSED_DEAL_STATUSES = ['closed', 'payment_sent', 'paid'] as const;

const normalizeAgentId = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Types.ObjectId) return value.toString();
  if (value && typeof value === 'object' && '_id' in value) {
    const inner = (value as { _id?: unknown })._id;
    if (typeof inner === 'string') return inner;
    if (inner instanceof Types.ObjectId) return inner.toString();
  }
  return String(value);
};

const toObjectId = (value: unknown): Types.ObjectId | null => {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
    return new Types.ObjectId(value);
  }
  if (value && typeof value === 'object' && '_id' in value) {
    const inner = (value as { _id?: unknown })._id;
    if (inner instanceof Types.ObjectId) return inner;
    if (typeof inner === 'string' && Types.ObjectId.isValid(inner)) {
      return new Types.ObjectId(inner);
    }
  }
  return null;
};

export async function GET(request: Request, { params }: Params) {
  const session = await getCurrentSession();
  if (!session) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OpenAI is not configured for suggestions.' }, { status: 503 });
  }

  await connectMongo();

  const referral = await Referral.findById(params.id)
    .populate('assignedAgent', 'userId')
    .populate('buySideAgent', 'userId')
    .populate('sellSideAgent', 'userId')
    .populate('lender', 'userId')
    .select(
      'assignedAgent buySideAgent sellSideAgent lender org lookingInZip lookingInZips deletedAt preApprovalAmountCents'
    );

  if (!referral || referral.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  const canManage = canManageReferral(session, {
    assignedAgent: referral.assignedAgent,
    buySideAgent: referral.buySideAgent,
    sellSideAgent: referral.sellSideAgent,
    lender: referral.lender,
    org: referral.org,
  });

  if (!canManage) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const previouslySuggested = url.searchParams
    .getAll('exclude')
    .map((value) => value.trim())
    .filter(Boolean);

  const excludedAgentIds = [
    referral.assignedAgent,
    referral.buySideAgent,
    referral.sellSideAgent,
    ...previouslySuggested,
  ]
    .map((value) => toObjectId(value))
    .filter((value): value is Types.ObjectId => Boolean(value));

  const targetZips = Array.from(
    new Set(
      [referral.lookingInZip, ...(Array.isArray(referral.lookingInZips) ? referral.lookingInZips : [])]
        .filter((zip): zip is string => typeof zip === 'string' && /^\d{5}$/u.test(zip.trim()))
        .map((zip) => zip.trim())
    )
  );

  if (targetZips.length === 0) {
    return NextResponse.json({ error: 'No valid ZIP codes found for this referral.' }, { status: 400 });
  }

  // Expand ZIP codes by 25 miles
  const expandedZips = await expandZipCodesBy25Miles(targetZips);

  const candidateAgents = await Agent.find<CandidateAgent>({
    active: true,
    zipCoverage: { $in: expandedZips },
    ...(excludedAgentIds.length ? { _id: { $nin: excludedAgentIds } } : {}),
  })
    .select('_id name coverageLocations zipCoverage specialties languages ahaDesignation closingRatePercentage npsScore')
    .limit(50)
    .lean();

  if (candidateAgents.length === 0) {
    const message = previouslySuggested.length
      ? 'All matching agents have already been suggested.'
      : 'No active agents cover these ZIP codes yet.';

    return NextResponse.json({ error: message }, { status: 404 });
  }

  const candidateIds = candidateAgents
    .map((agent) => normalizeAgentId(agent._id))
    .filter((value) => Types.ObjectId.isValid(value))
    .map((value) => new Types.ObjectId(value));

  const referralStats = await Referral.aggregate<{
    _id: Types.ObjectId;
    total: number;
    closed: number;
  }>([
    { $match: { assignedAgent: { $in: candidateIds } } },
    {
      $group: {
        _id: '$assignedAgent',
        total: { $sum: 1 },
        closed: {
          $sum: {
            $cond: [{ $eq: ['$status', 'closed'] }, 1, 0],
          },
        },
      },
    },
  ]);

  const closingStats = await Agent.aggregate<{
    _id: Types.ObjectId;
    averageClosedPriceCents: number;
  }>([
    {
      $lookup: {
        from: 'payments',
        localField: '_id',
        foreignField: 'agentId',
        as: 'payments',
      },
    },
    { $unwind: { path: '$payments', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'referrals',
        localField: 'payments.referralId',
        foreignField: '_id',
        as: 'referral',
      },
    },
    { $unwind: { path: '$referral', preserveNullAndEmptyArrays: true } },
    {
      $match: {
        _id: { $in: candidateIds },
        $or: [
          {
            'payments.status': { $in: CLOSED_DEAL_STATUSES },
            'payments.agentAttribution': { $ne: 'OUTSIDE_AGENT' }
          },
          { 'referral.assignedAgent': { $in: candidateIds } },
        ],
      },
    },
    {
      $group: {
        _id: '$_id',
        averageClosedPriceCents: {
          $avg: {
            $ifNull: ['$referral.closedPriceCents', '$referral.estPurchasePriceCents'],
          },
        },
      },
    },
  ]);

  const referralStatsMap = new Map<string, { total: number; closed: number }>();
  referralStats.forEach((entry) => {
    referralStatsMap.set(entry._id.toString(), { total: entry.total, closed: entry.closed });
  });

  const closingStatsMap = new Map<string, number>();
  closingStats.forEach((entry) => {
    closingStatsMap.set(entry._id.toString(), entry.averageClosedPriceCents ?? 0);
  });

  const agentSummaries = candidateAgents.map((agent) => ({
    id: normalizeAgentId(agent._id),
    name: agent.name,
    zipCoverage: Array.isArray(agent.zipCoverage) ? agent.zipCoverage : [],
    coverageLocations: Array.isArray(agent.coverageLocations) ? agent.coverageLocations : [],
    specialties: Array.isArray(agent.specialties) ? agent.specialties : [],
    languages: Array.isArray(agent.languages) ? agent.languages : [],
    ahaDesignation: agent.ahaDesignation ?? null,
    closeRate:
      referralStatsMap.get(normalizeAgentId(agent._id))?.total
        ? (referralStatsMap.get(normalizeAgentId(agent._id))!.closed /
            referralStatsMap.get(normalizeAgentId(agent._id))!.total) * 100
        : agent.closingRatePercentage ?? 0,
    npsScore: agent.npsScore ?? 0,
    averageClosedPriceCents: closingStatsMap.get(normalizeAgentId(agent._id)) ?? 0,
  }));

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'agent_suggestion',
          schema: {
            type: 'object',
            properties: {
              rankedAgents: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    agentId: { type: 'string' },
                    reason: { type: 'string' },
                  },
                  required: ['agentId'],
                  additionalProperties: false,
                },
                minItems: 1,
              },
            },
            required: ['rankedAgents'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You are an assistant that recommends real estate agents based on coverage and performance. Return all provided agents sorted best to worst, preferring coverage matches across the referral ZIP codes, higher close rates, higher NPS scores, and average closed prices closest to the borrower\'s pre-approval amount. Do not repeat or omit agents—rank them all in descending order of fit.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            lookingInZips: targetZips,
            preApprovalAmountCents: referral.preApprovalAmountCents ?? null,
            agents: agentSummaries,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.error('Agent suggestion OpenAI error', payload);
    return NextResponse.json({ error: 'Unable to suggest an agent right now.' }, { status: response.status });
  }

  const completion = await response.json();
  const content = completion.choices?.[0]?.message?.content;

  let rankedAgents: Array<{ agentId: string; reason?: string }> = [];

  if (content) {
    let parsedContent: unknown = null;
    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      console.error('Agent suggestion parse error', error);
    }
    const parsed = z
      .object({
        rankedAgents: z
          .array(
            z.object({
              agentId: z.string(),
              reason: z.string().optional(),
            })
          )
          .min(1),
      })
      .safeParse(parsedContent);

    if (parsed.success) {
      rankedAgents = parsed.data.rankedAgents;
    }
  }

  const excludedIds = new Set(previouslySuggested.map((value) => normalizeAgentId(value)));

  let suggestedAgent = agentSummaries.find((agent) => !excludedIds.has(agent.id));
  let suggestionReason: string | null = null;

  for (const entry of rankedAgents) {
    const match = agentSummaries.find((agent) => agent.id === entry.agentId);
    if (match && !excludedIds.has(match.id)) {
      suggestedAgent = match;
      suggestionReason = entry.reason ?? null;
      break;
    }
  }

  if (!suggestedAgent) {
    return NextResponse.json({ error: 'All matching agents have already been suggested.' }, { status: 404 });
  }

  return NextResponse.json({
    agentId: suggestedAgent.id,
    name: suggestedAgent.name,
    reason: suggestionReason ?? 'Matched by coverage area and ZIP code proximity.',
  });
}
