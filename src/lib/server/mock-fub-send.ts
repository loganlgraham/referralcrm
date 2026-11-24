import { createLiveFubClient, liveFubEnabled, readIntakeForHandoff } from '@/lib/server/live-fub-handoff';
import { createHash } from 'node:crypto';

import { Types } from 'mongoose';

import {
  storedAccountStatus,
  VERIFIED_FUB_ACCOUNT_ID,
} from '@/lib/intelligence/access-control';
import { createMockFubClient, type MockFubBehavior } from '@/lib/fub/mock-fub-client';
import {
  buildFubIntakeFields,
  buildFubIntakeSummary,
  resolveVerifiedAgentMapping,
} from '@/lib/fub/fub-send-policy';
import {
  MockFubApprovalContextMismatchError,
  MockFubOperationError,
  runMockFubApproval,
  type MockFubApprovalResult,
} from '@/lib/fub/mock-fub-orchestrator';
import { canUseMockFubFixture } from '@/lib/server/fixture-safety';
import {
  createMongooseMockFubAttemptRepository,
  createMongooseMockFubPersonRepository,
} from '@/lib/server/mock-fub-store';
import { IntelligenceAgentLink, IntelligenceLink } from '@/models/intelligence-link';
import {
  FubSendAttempt,
  MockFubSendAttempt,
  type MockFubAttemptStatus,
} from '@/models/mock-fub';
import { Referral } from '@/models/referral';
import { User } from '@/models/user';

export type MockFubMappingState = 'ready' | 'missing' | 'ambiguous';

export type MockFubApprovalPreview = {
  customerName: string;
  selectedAgentName: string;
  selectionSource: 'auto' | 'manual';
  mappingState: MockFubMappingState;
  existingPersonId: number | null;
  approvalKey: string;
  attemptStatus: MockFubAttemptStatus | null;
};

type MockFubServiceError = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 503;
  code:
    | 'fixture_unavailable'
    | 'not_admin'
    | 'not_found'
    | 'not_aha'
    | 'aha_oos'
    | 'agent_missing'
    | 'mapping_missing'
    | 'mapping_ambiguous'
    | 'approval_changed'
    | 'not_paired';
  message: string;
};

export type MockFubPreviewResult =
  | { ok: true; preview: MockFubApprovalPreview }
  | MockFubServiceError;

export type MockFubApprovalServiceResult =
  | { ok: true; result: MockFubApprovalResult }
  | MockFubServiceError;

type LoadedApproval = {
  referralId: string;
  customer: {
    firstName: string;
    lastName: string;
    name: string;
    email: string;
    phone: string;
  };
  selectedAgentId: string;
  selectedAgentName: string;
  selectionSource: 'auto' | 'manual';
  fubUserId: number | null;
  mappingState: MockFubMappingState;
  existingPersonId: number | null;
  status: string;
  intakeFields: Record<string, string>;
  inboundMessageId?: string;
};

function serviceError(
  status: MockFubServiceError['status'],
  code: MockFubServiceError['code'],
  message: string,
): MockFubServiceError {
  return { ok: false, status, code, message };
}

function populatedId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const record = value as { _id?: unknown };
    if (record._id) return String(record._id);
  }
  return String(value);
}

function populatedName(value: unknown): string {
  if (value && typeof value === 'object') {
    const name = (value as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return 'Selected agent';
}

async function loadApproval(
  referralId: string,
  actorId: string,
): Promise<LoadedApproval | MockFubServiceError> {
  if (!liveFubEnabled() && !canUseMockFubFixture()) {
    return serviceError(
      503,
      'fixture_unavailable',
      'Mock FUB sending is available only in the isolated fixture.',
    );
  }
  if (!Types.ObjectId.isValid(actorId) || !Types.ObjectId.isValid(referralId)) {
    return serviceError(404, 'not_found', 'Referral not found.');
  }

  const actor = await User.findById(actorId)
    .select('role disabled active status')
    .lean<{
      role?: string | null;
      disabled?: boolean;
      active?: boolean;
      status?: string | null;
    } | null>();
  if (!actor || actor.role !== 'admin' || storedAccountStatus(actor) !== 'active') {
    return serviceError(403, 'not_admin', 'Only an active admin can approve this send.');
  }

  const referral = await Referral.findById(referralId)
    .select(
      'borrower inboundEmail endorser clientType preApprovalAmountCents estPurchasePriceCents propertyAddress propertyCity propertyState propertyPostalCode initialNotes timeline lender source loanFileNumber lookingInZip lookingInZips borrowerCurrentAddress loanType stageOnTransfer org ahaBucket assignedAgent buySideAgent agentSelectionSource status deletedAt',
    )
    .populate('lender', 'name')
    .populate('assignedAgent', 'name')
    .populate('buySideAgent', 'name')
    .lean<Record<string, any> | null>();
  if (!referral || referral.deletedAt) {
    return serviceError(404, 'not_found', 'Referral not found.');
  }
  if (referral.org !== 'AHA') {
    return serviceError(400, 'not_aha', 'Only AHA referrals are supported.');
  }
  if (referral.ahaBucket === 'AHA_OOS') {
    return serviceError(400, 'aha_oos', 'AHA OOS sending is not included in this fixture.');
  }
  if (referral.ahaBucket !== 'AHA') {
    return serviceError(400, 'not_aha', 'The referral is not in the AHA intake bucket.');
  }

  const selectedAgent = referral.buySideAgent ?? referral.assignedAgent ?? null;
  const selectedAgentId = populatedId(selectedAgent);
  if (!selectedAgentId) {
    return serviceError(409, 'agent_missing', 'Select an agent before sending to FUB.');
  }

  const links = await IntelligenceAgentLink.find({
    organization: 'AHA',
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
  })
    .select('agentId fubUserId audit')
    .lean<
      Array<{
        agentId: unknown;
        fubUserId?: number;
        audit?: Array<{
          action?: string;
          nextPersonId?: number | null;
        }>;
      }>
    >();
  const mapping = resolveVerifiedAgentMapping(
    links.map((link) => {
      const latestAudit = link.audit?.at(-1);
      return {
        agentId: String(link.agentId),
        fubUserId: Number(link.fubUserId),
        auditedFubUserId:
          (latestAudit?.action === 'link' || latestAudit?.action === 'correct') &&
          Number.isSafeInteger(latestAudit.nextPersonId)
            ? (latestAudit.nextPersonId ?? null)
            : null,
      };
    }),
    selectedAgentId,
  );

  const customerLink = await IntelligenceLink.findOne({
    organization: 'AHA',
    fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
    referralId: new Types.ObjectId(referralId),
    participantKey: 'borrower',
  })
    .select('fubPersonId')
    .lean<{ fubPersonId?: number | null } | null>();

  const borrower = referral.borrower ?? {};
  return {
    referralId,
    customer: {
      firstName: String(borrower.firstName ?? ''),
      lastName: String(borrower.lastName ?? ''),
      name: String(borrower.name ?? 'Customer'),
      email: String(borrower.email ?? ''),
      phone: String(borrower.phone ?? ''),
    },
    selectedAgentId,
    selectedAgentName: populatedName(selectedAgent),
    selectionSource: referral.agentSelectionSource === 'manual' ? 'manual' : 'auto',
    fubUserId: mapping.state === 'ready' ? mapping.fubUserId : null,
    mappingState: mapping.state,
    existingPersonId:
      typeof customerLink?.fubPersonId === 'number' ? customerLink.fubPersonId : null,
    status: String(referral.status ?? ''),
    inboundMessageId: referral.inboundEmail?.messageId,
    intakeFields: {
      ...Object.fromEntries(Object.entries({
        firstName: borrower.firstName || String(borrower.name || '').split(/\s+/)[0],
        lastName: borrower.lastName || String(borrower.name || '').split(/\s+/).slice(1).join(' '),
        borrowerEmail: borrower.email, borrowerPhone: borrower.phone, endorser: referral.endorser,
        clientType: referral.clientType, timeline: referral.timeline, initialNotes: referral.initialNotes,
        mortgageConsultant: referral.lender?.name, agent: populatedName(selectedAgent),
        propertyAddress: referral.propertyAddress, propertyCity: referral.propertyCity, propertyState: referral.propertyState,
        propertyPostalCode: referral.propertyPostalCode,
        estimatedPurchasePrice: referral.estPurchasePriceCents != null ? String(referral.estPurchasePriceCents / 100) : null,
        preApprovalAmount: referral.preApprovalAmountCents != null ? String(referral.preApprovalAmountCents / 100) : null,
      }).filter((entry): entry is [string,string] => typeof entry[1] === 'string' && entry[1].trim() !== '')),
      ...buildFubIntakeFields({
      source: referral.source,
      loanFileNumber: referral.loanFileNumber,
      lookingInZip: referral.lookingInZip,
      lookingInZips: referral.lookingInZips,
      borrowerCurrentAddress: referral.borrowerCurrentAddress,
      loanType: referral.loanType,
      stageOnTransfer: referral.stageOnTransfer,
    }),
    },
  };
}

function publicPreview(loaded: LoadedApproval): MockFubApprovalPreview {
  return {
    customerName: loaded.customer.name,
    selectedAgentName: loaded.selectedAgentName,
    selectionSource: loaded.selectionSource,
    mappingState: loaded.mappingState,
    existingPersonId: loaded.existingPersonId,
    approvalKey: approvalFingerprint(loaded),
    attemptStatus: null,
  };
}

function approvalFingerprint(loaded: LoadedApproval): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        referralId: loaded.referralId,
        customerEmail: loaded.customer.email,
        customerPhone: loaded.customer.phone,
        selectedAgentId: loaded.selectedAgentId,
        fubUserId: loaded.fubUserId,
        existingPersonId: loaded.existingPersonId,
      }),
    )
    .digest('hex');
}

export async function readMockFubApprovalPreview(input: {
  referralId: string;
  actorId: string;
}): Promise<MockFubPreviewResult> {
  const loaded = await loadApproval(input.referralId, input.actorId);
  if ('ok' in loaded) return loaded;
  const preview = publicPreview(loaded);
  const attempt = await (liveFubEnabled() ? FubSendAttempt : MockFubSendAttempt).findOne({
    fixtureRunId: liveFubEnabled() ? 'aha-production' : process.env.FUB_FIXTURE_RUN_ID,
    referralId: new Types.ObjectId(input.referralId),
  })
    .select('status approvalKey')
    .lean<{
      _id?: unknown;
      status?: MockFubAttemptStatus;
      approvalKey?: string;
    } | null>();
  let attemptStatus = attempt?.status ?? null;
  if (attempt?._id && attemptStatus === 'running') {
    const now = new Date();
    const reconciled =
      await createMongooseMockFubAttemptRepository(liveFubEnabled()).markStaleRunningAmbiguous(
        String(attempt._id),
        new Date(now.getTime() - 60_000),
        now,
      );
    attemptStatus = reconciled?.status ?? attemptStatus;
  }
  preview.attemptStatus = attemptStatus;
  if (attempt?.approvalKey) preview.approvalKey = attempt.approvalKey;
  return { ok: true, preview };
}

type FixtureFailureScenario = {
  operation: 'resolve_customer' | 'assign_agent' | 'populate_fields' | 'add_note';
  mode: 'definitive_once' | 'ambiguous_before_once' | 'ambiguous_after_once';
};

const consumedFixtureFailures = new Set<string>();

function fixtureBehavior(referralId: string): MockFubBehavior | undefined {
  const raw = process.env.FUB_MOCK_SCENARIOS;
  if (!raw) return undefined;
  let scenarios: Record<string, FixtureFailureScenario>;
  try {
    scenarios = JSON.parse(raw) as Record<string, FixtureFailureScenario>;
  } catch {
    return undefined;
  }
  const scenario = scenarios[referralId];
  if (!scenario) return undefined;
  const key = `${process.env.FUB_FIXTURE_RUN_ID}:${referralId}:${scenario.operation}:${scenario.mode}`;
  return ({ operation, phase }) => {
    if (consumedFixtureFailures.has(key) || operation !== scenario.operation) return;
    const shouldThrow =
      (scenario.mode === 'definitive_once' && phase === 'before') ||
      (scenario.mode === 'ambiguous_before_once' && phase === 'before') ||
      (scenario.mode === 'ambiguous_after_once' && phase === 'after');
    if (!shouldThrow) return;
    consumedFixtureFailures.add(key);
    if (scenario.mode === 'definitive_once') {
      throw new MockFubOperationError(
        'definitive',
        'fixture_partial_failure',
        'The fixture rejected this operation before applying it.',
      );
    }
    throw new MockFubOperationError(
      'ambiguous',
      'fixture_timeout',
      'The fixture timed out without a safe resend decision.',
    );
  };
}

export async function approveMockFubSend(input: {
  referralId: string;
  actorId: string;
  approvalKey: string;
}): Promise<MockFubApprovalServiceResult> {
  const loaded = await loadApproval(input.referralId, input.actorId);
  if ('ok' in loaded) return loaded;
  if (loaded.status !== 'Paired') {
    return serviceError(
      409,
      'not_paired',
      'Move the referral to Paired before approving the FUB send.',
    );
  }
  if (loaded.mappingState === 'ambiguous') {
    return serviceError(
      409,
      'mapping_ambiguous',
      'The selected agent mapping is ambiguous and must be corrected.',
    );
  }
  if (loaded.mappingState === 'missing' || loaded.fubUserId === null) {
    return serviceError(
      409,
      'mapping_missing',
      'The selected agent needs a verified FUB user mapping.',
    );
  }
  const live = liveFubEnabled();
  const fixtureRunId = live ? 'aha-production' : process.env.FUB_FIXTURE_RUN_ID as string;
  const existingAttempt = await (live ? FubSendAttempt : MockFubSendAttempt).findOne({
    fixtureRunId,
    referralId: new Types.ObjectId(input.referralId),
  })
    .select('approvalKey selectedAgentId fubUserId personId')
    .lean<{
      approvalKey?: string;
      selectedAgentId?: unknown;
      personId?: number;
      fubUserId?: number;
    } | null>();
  if (existingAttempt?.personId && loaded.existingPersonId && existingAttempt.personId !== loaded.existingPersonId) {
    return serviceError(409, 'approval_changed', 'The linked customer changed during the handoff. Check the two records before continuing.');
  }
  const matchesExistingAttempt =
    existingAttempt?.approvalKey === input.approvalKey &&
    String(existingAttempt.selectedAgentId) === loaded.selectedAgentId &&
    existingAttempt.fubUserId === loaded.fubUserId;
  if (
    existingAttempt
      ? !matchesExistingAttempt
      : input.approvalKey !== approvalFingerprint(loaded)
  ) {
    return serviceError(
      409,
      'approval_changed',
      'The customer or selected-agent details changed. Review them again before sending.',
    );
  }

  const note = buildFubIntakeSummary({
    referralId: loaded.referralId,
    customerName: loaded.customer.name,
    selectedAgentName: loaded.selectedAgentName,
    selectionSource: loaded.selectionSource,
    fields: loaded.intakeFields,
  });
  if (live && loaded.inboundMessageId) {
    try {
      const intake = await readIntakeForHandoff(loaded.inboundMessageId);
      loaded.intakeFields = { ...intake.fields, ...loaded.intakeFields };
      note.label = 'Original Referrio intake email';
      note.body = intake.note;
    } catch {
      return serviceError(503, 'fixture_unavailable', 'The original intake email could not be retrieved. Retry after it is available.');
    }
  }
  const repository = createMongooseMockFubAttemptRepository(live);
  const baseClient = live ? createLiveFubClient(loaded.fubUserId) : createMockFubClient({
    fixtureRunId,
    repository: createMongooseMockFubPersonRepository(),
    behavior: fixtureBehavior(loaded.referralId),
  });
  let result: MockFubApprovalResult;
  try {
    result = await runMockFubApproval(
      {
        fixtureRunId,
        referralId: loaded.referralId,
        approvalKey: input.approvalKey,
        actorId: input.actorId,
        customer: { ...loaded.customer, firstName: loaded.customer.firstName || loaded.intakeFields.firstName || '', lastName: loaded.customer.lastName || loaded.intakeFields.lastName || '' },
        selectedAgentId: loaded.selectedAgentId,
        selectedAgentName: loaded.selectedAgentName,
        selectionSource: loaded.selectionSource,
        fubUserId: loaded.fubUserId,
        existingPersonId: loaded.existingPersonId,
        intakeFields: loaded.intakeFields,
        note,
      },
      { repository, client: baseClient },
    );
  } catch (error) {
    if (error instanceof MockFubApprovalContextMismatchError) {
      return serviceError(
        409,
        'approval_changed',
        'The selected agent or FUB mapping changed. Review it again before sending.',
      );
    }
    throw error;
  }

  if (!loaded.existingPersonId && result.personId) {
    try {
      await IntelligenceLink.create({
        organization: 'AHA',
        fubAccountId: VERIFIED_FUB_ACCOUNT_ID,
        referralId: new Types.ObjectId(loaded.referralId),
        participantKey: 'borrower',
        fubPersonId: result.personId,
        audit: [
          {
            actorId: new Types.ObjectId(input.actorId),
            at: new Date(),
            action: 'link',
            previousPersonId: null,
            nextPersonId: result.personId,
          },
        ],
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      // A verified link won the race. Preserve it rather than correcting it.
    }
  }

  return { ok: true, result };
}
