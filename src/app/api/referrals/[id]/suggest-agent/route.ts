import { NextResponse } from 'next/server';
import { z } from 'zod';

import { Types } from 'mongoose';

import { connectMongo } from '@/lib/mongoose';
import { getCurrentSession } from '@/lib/auth';
import { Referral } from '@/models/referral';
import { Agent } from '@/models/agent';
import { canManageReferral } from '@/lib/rbac';

interface Params {
  params: { id: string };
}

const suggestionResponseSchema = z.object({
  agentId: z.string().trim(),
  reason: z.string().trim().optional(),
});

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

const normalizeAgentId = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Types.ObjectId) return value.toString();
  return String(value);
};

export async function GET(_: Request, { params }: Params) {
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

  const excludedAgentIds = [
    referral.assignedAgent,
    referral.buySideAgent,
    referral.sellSideAgent,
  ]
    .filter((value): value is Types.ObjectId => Boolean(value))
    .map((id) => id.toString());

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

  const candidateAgents = await Agent.find<CandidateAgent>({
    active: true,
    zipCoverage: { $in: targetZips },
    ...(excludedAgentIds.length ? { _id: { $nin: excludedAgentIds } } : {}),
  })
    .select('_id name coverageLocations zipCoverage specialties languages ahaDesignation closingRatePercentage npsScore')
    .limit(50)
    .lean();

  if (candidateAgents.length === 0) {
    return NextResponse.json({ error: 'No active agents cover these ZIP codes yet.' }, { status: 404 });
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
          { 'payments.status': { $in: ['closed', 'paid'] }, 'payments.agentAttribution': { $ne: 'OUTSIDE_AGENT' } },
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
              agentId: { type: 'string' },
              reason: { type: 'string' },
            },
            required: ['agentId'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You are an assistant that recommends the best real estate agent based on coverage areas and past performance. Choose the single best agent from the provided list who covers the referral ZIP codes. Prefer agents whose coverage matches more ZIP codes, who have higher close rates and NPS scores, and whose average closed price best aligns with the borrower\'s pre-approval amount. Avoid suggesting any already-assigned agents and surface the strongest alternate match.',
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

  let agentId: string | null = null;
  let reason: string | null = null;

  if (content) {
    let parsedContent: unknown = null;
    try {
      parsedContent = JSON.parse(content);
    } catch (error) {
      console.error('Agent suggestion parse error', error);
    }
    const parsed = suggestionResponseSchema.safeParse(parsedContent);
    if (parsed.success) {
      agentId = parsed.data.agentId;
      reason = parsed.data.reason ?? null;
    }
  }

  const suggestedAgent = agentSummaries.find((agent) => agent.id === agentId) ?? agentSummaries[0];

  return NextResponse.json({
    agentId: suggestedAgent.id,
    name: suggestedAgent.name,
    reason: reason ?? 'Matched by coverage area and ZIP code proximity.',
  });
}
