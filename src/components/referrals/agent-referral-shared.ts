import { REFERRAL_STATUSES, type ReferralStatus } from '@/constants/referrals';
import type { ReferralRow } from '@/components/tables/referral-table';
import { formatCurrencyWhole } from '@/utils/formatters';

export type AgentReferralFilterId = 'needs-update' | 'all' | 'under-contract' | 'closed';

export interface AgentReferralFilter {
  id: AgentReferralFilterId;
  label: string;
  matches: (row: ReferralRow) => boolean;
}

export const AGENT_REFERRAL_FILTERS: AgentReferralFilter[] = [
  { id: 'needs-update', label: 'Needs update', matches: (row) => Boolean(row.needsUpdate) },
  { id: 'all', label: 'All', matches: () => true },
  { id: 'under-contract', label: 'Under contract', matches: (row) => row.status === 'Under Contract' },
  { id: 'closed', label: 'Closed', matches: (row) => row.status === 'Closed' }
];

const AGENT_PIPELINE_STATUSES: ReferralStatus[] = REFERRAL_STATUSES.filter(
  (status) => status !== 'Closed' && status !== 'Terminated' && status !== 'Lost'
);

/**
 * Every outcome an agent can set from the list, matching the status select they
 * have always had. `New Lead` is only offered while the referral is still
 * sitting there.
 */
export function getAgentStatusChoices(current: ReferralStatus): ReferralStatus[] {
  const pipeline = AGENT_PIPELINE_STATUSES.filter(
    (status) => status !== 'New Lead' || current === 'New Lead'
  );
  return [...pipeline, 'Closed', 'Terminated', 'Lost'];
}

/**
 * Statuses that open an input toast before anything is written. Bulk mode skips
 * them so a run of referrals cannot stack prompts on top of each other.
 */
export const AGENT_STATUSES_NEEDING_INPUT: ReferralStatus[] = [
  'Under Contract',
  'Closed',
  'Terminated',
  'Lost'
];

/** Outcomes that end the referral badly render quieter than the pipeline chips. */
export function isQuietStatusChoice(status: ReferralStatus): boolean {
  return status === 'Lost' || status === 'Terminated';
}

export function matchesAgentSearch(row: ReferralRow, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return true;
  }
  return [row.borrowerName, row.borrowerEmail, row.loanFileNumber].some((field) =>
    typeof field === 'string' ? field.toLowerCase().includes(trimmed) : false
  );
}

export function formatReferredDate(iso?: string | null): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function formatRelativeDays(iso?: string | null, now: Date = new Date()): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const days = Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
  if (days <= 0) {
    return 'today';
  }
  return `${days}d ago`;
}

export function describeClientSide(clientType: ReferralRow['clientType']): string {
  return clientType === 'Both' ? 'Buyer & seller' : clientType;
}

export type AgentReferralEyebrowFactKind = 'pre-approval' | 'looking-in' | 'loan-type' | 'referred';

export interface AgentReferralEyebrowFact {
  kind: AgentReferralEyebrowFactKind;
  text: string;
  numeric?: string;
}

export interface AgentReferralEyebrowInput {
  clientType?: string | null;
  preApprovalAmountCents?: number | null;
  lookingIn?: string | null;
  lookingInZip?: string | null;
  lookingInZips?: Array<string | null | undefined> | null;
  loanType?: string | null;
  referredAt?: string | null;
  includeReferredDate?: boolean;
}

function resolveClientType(clientType?: string | null): ReferralRow['clientType'] {
  if (clientType === 'Seller' || clientType === 'Both' || clientType === 'Buyer') {
    return clientType;
  }
  return 'Buyer';
}

export function formatLookingInDisplay(
  lookingInZip?: string | null,
  lookingInZips?: Array<string | null | undefined> | null
): string {
  const values = Array.isArray(lookingInZips)
    ? lookingInZips.flatMap((zip) => {
        const trimmed = typeof zip === 'string' ? zip.trim() : '';
        return trimmed ? [trimmed] : [];
      })
    : [];
  if (values.length > 0) {
    return values.join(', ');
  }
  return typeof lookingInZip === 'string' ? lookingInZip.trim() : '';
}

export function pickAgentReferralEyebrowFact(
  input: AgentReferralEyebrowInput
): AgentReferralEyebrowFact | null {
  const amount = input.preApprovalAmountCents;
  if (typeof amount === 'number' && amount > 0) {
    const numeric = formatCurrencyWhole(amount);
    return {
      kind: 'pre-approval',
      text: `pre-approved up to ${numeric}`,
      numeric
    };
  }

  const lookingIn =
    (typeof input.lookingIn === 'string' ? input.lookingIn.trim() : '') ||
    formatLookingInDisplay(input.lookingInZip, input.lookingInZips);
  if (lookingIn) {
    return { kind: 'looking-in', text: `looking in ${lookingIn}` };
  }

  const loanType = typeof input.loanType === 'string' ? input.loanType.trim() : '';
  if (loanType) {
    return { kind: 'loan-type', text: loanType };
  }

  if (input.includeReferredDate !== false) {
    const referred = formatReferredDate(input.referredAt);
    if (referred) {
      return { kind: 'referred', text: `referred ${referred}` };
    }
  }

  return null;
}

export function describeAgentReferralEyebrow(input: AgentReferralEyebrowInput): string {
  const client = describeClientSide(resolveClientType(input.clientType));
  const fact = pickAgentReferralEyebrowFact(input);
  return fact ? `${client} · ${fact.text}` : client;
}

/**
 * Shared column template so the label row, group headers, action rows, quiet
 * rows and the expanded panel all line up on the same four columns.
 */
export const AGENT_ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_176px_minmax(0,1fr)_300px] gap-5';
export const AGENT_ROW_GRID_SELECTABLE =
  'grid grid-cols-[28px_minmax(0,1fr)_176px_minmax(0,1fr)_300px] gap-5';
