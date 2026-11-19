import { Types } from 'mongoose';
import {
  AGENT_RECOMMENDATION_POLICY,
  deriveAgentOutcomes,
  fubAdjustments,
  isActiveReferralStatus,
  rankAgents,
  selectEligibleAgents,
  windowStart,
  type CandidateAgent,
  type FubActivityInput,
  type HistoryReferral,
} from '@/lib/recommendations/agent-policy';
import { emptyRecommendationResponse, type AgentRecommendationResponse, type RecommendationFubState } from '@/lib/recommendations/agent-recommendation-response';
import { fetchStoredAgentActivity } from '@/lib/intelligence/agent-activity';
import { VERIFIED_FUB_ACCOUNT_ID } from '@/lib/intelligence/access-control';
import { Agent } from '@/models/agent';
import { IntelligenceAgentLink } from '@/models/intelligence-link';
import { LenderMC } from '@/models/lender';
import { Payment } from '@/models/payment';
import { Referral } from '@/models/referral';

const ZIP = /^\d{5}$/;
const MAX_ZIPS = 10;
const RETURNED_AGENTS = 25;
const ACTIVE_STATUS_VALUES = ['Paired', 'In Communication', 'Active Lead', 'Showing Homes', 'Under Contract'];

type IdLike = Types.ObjectId | string | null | undefined;

const idOf = (value: IdLike): string | null => (value ? String(value) : null);

export function parseZipParam(value: string | null): string[] | null {
  if (value === null) return null;
  return Array.from(new Set(value.split(',').map((zip) => zip.trim()).filter((zip) => ZIP.test(zip)))).slice(0, MAX_ZIPS);
}

export function parseMcParam(value: string | null): string | null | undefined {
  if (value === null) return undefined;
  if (value === '' || value === 'none') return null;
  return Types.ObjectId.isValid(value) ? value : undefined;
}

export type RecommendationReferral = {
  _id: Types.ObjectId;
  org?: string | null;
  ahaBucket?: string | null;
  lookingInZip?: string | null;
  lookingInZips?: string[] | null;
  lender?: IdLike;
};

/** Read-only. No referral, assignment, score, or Follow Up Boss record changes. */
export async function buildAgentRecommendations(input: {
  referral: RecommendationReferral;
  mcOverride: string | null | undefined;
  zipOverride: string[] | null;
  fubPermitted: boolean;
  now?: Date;
}): Promise<AgentRecommendationResponse> {
  const now = input.now ?? new Date();
  const version = AGENT_RECOMMENDATION_POLICY.version;
  const referralId = String(input.referral._id);
  const storedZips = [input.referral.lookingInZip, ...(input.referral.lookingInZips ?? [])]
    .filter((zip): zip is string => typeof zip === 'string' && ZIP.test(zip.trim()))
    .map((zip) => zip.trim());
  const zips = input.zipOverride ?? Array.from(new Set(storedZips)).slice(0, MAX_ZIPS);
  const mcId = input.mcOverride === undefined ? idOf(input.referral.lender) : input.mcOverride;
  const storedBucket = input.referral.ahaBucket;
  const bucket: 'AHA' | 'AHA_OOS' | null = storedBucket === 'AHA' || storedBucket === 'AHA_OOS' ? storedBucket : null;

  if (input.referral.org !== 'AHA') return emptyRecommendationResponse('not_applicable', version);

  const [agentDocs, mcDoc] = await Promise.all([
    bucket
      ? Agent.find({ ahaDesignation: bucket }).select('name active ahaDesignation zipCoverage coverageLocations').lean<{
          _id: Types.ObjectId;
          name?: string;
          active?: boolean;
          ahaDesignation?: string | null;
          zipCoverage?: string[];
          coverageLocations?: { zipCodes?: string[] }[];
        }[]>()
      : Promise.resolve([]),
    mcId ? LenderMC.findById(mcId).select('name').lean<{ name?: string } | null>() : Promise.resolve(null),
  ]);
  const candidates: CandidateAgent[] = agentDocs.map((doc) => ({
    id: String(doc._id),
    name: doc.name ?? 'Unnamed agent',
    active: doc.active !== false,
    ahaDesignation: doc.ahaDesignation ?? null,
    coveredZips: Array.from(new Set([...(doc.zipCoverage ?? []), ...(doc.coverageLocations ?? []).flatMap((location) => location.zipCodes ?? [])].map((zip) => String(zip).trim()))),
  }));
  const eligibility = selectEligibleAgents({ org: input.referral.org ?? null, bucket, zips, agents: candidates });
  const inputs = { mcId: mcDoc ? mcId : null, mcName: mcDoc?.name ?? null, zips, bucket };
  const effectiveMcId = mcDoc ? mcId : null;
  const start = windowStart(now);
  const totalsBase = {
    eligible: eligibility.eligible.length,
    inactive: eligibility.excluded.inactive,
    noZipCoverage: eligibility.excluded.noZipCoverage,
    windowStart: start.toISOString(),
  };
  if (eligibility.reason !== 'ok') {
    const state = eligibility.reason === 'no_bucket' ? 'needs_bucket' : eligibility.reason === 'no_zip' ? 'needs_zip' : eligibility.reason === 'not_aha' ? 'not_applicable' : 'no_candidates';
    const empty = emptyRecommendationResponse(state, version);
    return { ...empty, inputs, totals: { ...empty.totals, ...totalsBase } };
  }

  const eligibleIds = eligibility.eligible.map((agent) => new Types.ObjectId(agent.id));
  const currentId = new Types.ObjectId(referralId);
  const agentMatch = [{ assignedAgent: { $in: eligibleIds } }, { buySideAgent: { $in: eligibleIds } }, { sellSideAgent: { $in: eligibleIds } }];

  const [creditedReferralIds, activeDocs] = await Promise.all([
    Payment.distinct('referralId', { agentId: { $in: eligibleIds } }) as Promise<Types.ObjectId[]>,
    Referral.find({ deletedAt: null, _id: { $ne: currentId }, status: { $in: ACTIVE_STATUS_VALUES }, $or: agentMatch })
      .select('assignedAgent buySideAgent sellSideAgent status')
      .lean<{ assignedAgent?: IdLike; buySideAgent?: IdLike; sellSideAgent?: IdLike; status?: string }[]>(),
  ]);
  const historyDocs = await Referral.find({
    deletedAt: null,
    _id: { $ne: currentId },
    $and: [
      { $or: [...agentMatch, { _id: { $in: creditedReferralIds } }] },
      { $or: [{ createdAt: { $gte: start } }, { referralDate: { $gte: start } }] },
    ],
  })
    .select('createdAt referralDate clientType status buyStatus sellStatus lostReason lender lookingInZip lookingInZips assignedAgent buySideAgent sellSideAgent')
    .lean<{
      _id: Types.ObjectId;
      createdAt: Date;
      referralDate?: Date | null;
      clientType?: 'Buyer' | 'Seller' | 'Both';
      status?: string;
      buyStatus?: string;
      sellStatus?: string;
      lostReason?: string | null;
      lender?: IdLike;
      lookingInZip?: string;
      lookingInZips?: string[];
      assignedAgent?: IdLike;
      buySideAgent?: IdLike;
      sellSideAgent?: IdLike;
    }[]>();
  const paymentDocs = historyDocs.length
    ? await Payment.find({ referralId: { $in: historyDocs.map((doc) => doc._id) } })
        .select('referralId agentId side status agentAttribution usedAssignedAgent usedAfc')
        .lean<{ referralId: Types.ObjectId; agentId?: IdLike; side?: 'buy' | 'sell'; status?: string; agentAttribution?: string | null; usedAssignedAgent?: boolean; usedAfc?: boolean }[]>()
    : [];
  const paymentsByReferral = new Map<string, HistoryReferral['payments']>();
  for (const payment of paymentDocs) {
    const key = String(payment.referralId);
    paymentsByReferral.set(key, [
      ...(paymentsByReferral.get(key) ?? []),
      {
        agentId: idOf(payment.agentId),
        side: payment.side ?? null,
        status: payment.status ?? null,
        agentAttribution: payment.agentAttribution ?? null,
        usedAssignedAgent: typeof payment.usedAssignedAgent === 'boolean' ? payment.usedAssignedAgent : null,
        usedAfc: typeof payment.usedAfc === 'boolean' ? payment.usedAfc : null,
      },
    ]);
  }
  const history: HistoryReferral[] = historyDocs.map((doc) => ({
    id: String(doc._id),
    createdAt: new Date(doc.createdAt),
    referralDate: doc.referralDate ? new Date(doc.referralDate) : null,
    clientType: doc.clientType ?? null,
    status: doc.status ?? null,
    buyStatus: doc.buyStatus ?? null,
    sellStatus: doc.sellStatus ?? null,
    lostReason: doc.lostReason ?? null,
    lenderId: idOf(doc.lender),
    zips: Array.from(new Set([doc.lookingInZip, ...(doc.lookingInZips ?? [])].filter((zip): zip is string => typeof zip === 'string').map((zip) => zip.trim()))),
    assignedAgentId: idOf(doc.assignedAgent),
    buySideAgentId: idOf(doc.buySideAgent),
    sellSideAgentId: idOf(doc.sellSideAgent),
    payments: paymentsByReferral.get(String(doc._id)) ?? [],
  }));

  const eligibleSet = new Set(eligibility.eligible.map((agent) => agent.id));
  const outcomes = deriveAgentOutcomes(history, now).filter((outcome) => eligibleSet.has(outcome.agentId));
  const activeCounts = new Map<string, number>();
  for (const doc of activeDocs) {
    if (!isActiveReferralStatus(doc.status ?? null)) continue;
    const agents = new Set([idOf(doc.assignedAgent), idOf(doc.buySideAgent), idOf(doc.sellSideAgent)].filter((id): id is string => id !== null && eligibleSet.has(id)));
    for (const id of agents) activeCounts.set(id, (activeCounts.get(id) ?? 0) + 1);
  }

  const fubInput = await readFubActivity({ referralId, eligibleIds: eligibility.eligible.map((agent) => agent.id), permitted: input.fubPermitted });
  const fub = fubAdjustments(eligibility.eligible.map((agent) => agent.id), fubInput.policy);
  const result = rankAgents({ candidates: eligibility.eligible, outcomes, activeCounts, mcId: effectiveMcId, zips, fub });
  const adjustedAgents = result.ranked.filter((entry) => entry.fub.state === 'applied').length;

  return {
    officialScoring: false,
    preview: true,
    policyVersion: version,
    state: 'ready',
    generatedAt: now.toISOString(),
    inputs,
    recommendations: result.ranked.slice(0, RETURNED_AGENTS),
    totals: {
      ...totalsBase,
      resolvedOutcomes: outcomes.filter((outcome) => outcome.outcome === 'closed' || outcome.outcome === 'not_closed').length,
      activeOutcomes: outcomes.filter((outcome) => outcome.outcome === 'active').length,
      excludedOutcomes: outcomes.filter((outcome) => outcome.outcome === 'excluded').length,
    },
    baselines: result.baselines,
    workloadMedian: result.workloadMedian,
    fub: { state: adjustedAgents > 0 ? 'applied' : fubInput.state, linkedAgents: fubInput.linkedAgents, adjustedAgents },
  };
}

async function readFubActivity(input: { referralId: string; eligibleIds: string[]; permitted: boolean }): Promise<{
  state: RecommendationFubState;
  linkedAgents: number;
  policy: { permitted: boolean; connected: boolean; activity: FubActivityInput };
}> {
  const activity: FubActivityInput = new Map();
  if (!input.permitted) return { state: 'not_permitted', linkedAgents: 0, policy: { permitted: false, connected: false, activity } };
  const links = await IntelligenceAgentLink.find({
    organization: 'AHA',
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
    agentId: { $in: input.eligibleIds.map((id) => new Types.ObjectId(id)) },
  })
    .select('agentId fubUserId')
    .lean<{ agentId: Types.ObjectId; fubUserId: number }[]>();
  if (links.length === 0) return { state: 'not_linked', linkedAgents: 0, policy: { permitted: true, connected: true, activity } };
  const secret = process.env.REFERRIO_INTEGRATION_SECRET ?? '';
  const customerUrl = process.env.REFERRIO_INTELLIGENCE_URL ?? '';
  if (!secret || !customerUrl) return { state: 'not_connected', linkedAgents: links.length, policy: { permitted: true, connected: false, activity } };
  const remote = await fetchStoredAgentActivity({
    organization: 'AHA',
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
    referralId: input.referralId,
    fubUserIds: links.map((link) => link.fubUserId),
    secret,
    customerUrl,
  });
  const byUser = new Map(remote.state === 'ready' ? remote.users.map((user) => [user.fubUserId, user]) : []);
  for (const link of links) {
    const user = byUser.get(link.fubUserId);
    if (remote.state !== 'ready' || !user || user.state !== 'measured') {
      activity.set(String(link.agentId), { state: 'unavailable' });
      continue;
    }
    activity.set(String(link.agentId), {
      state: 'measured',
      assignedPeople: user.assignedPeople,
      contactedPeople: user.contactedPeople,
      coverageComplete: remote.coverageComplete,
    });
  }
  if (remote.state !== 'ready') console.info(JSON.stringify({ source: 'referrio-agent-recommendation', fub: 'unavailable', reason: remote.reason }));
  return { state: remote.state === 'ready' ? 'insufficient' : 'unavailable', linkedAgents: links.length, policy: { permitted: true, connected: true, activity } };
}
