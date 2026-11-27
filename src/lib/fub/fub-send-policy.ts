export type AgentFubMapping = {
  agentId: string;
  fubUserId: number;
  auditedFubUserId: number | null;
};

export type VerifiedAgentMapping =
  | { state: 'ready'; fubUserId: number }
  | { state: 'missing' }
  | { state: 'ambiguous' };

export const AHA_OOS_FUB_ASSIGNEE = 'Kristen Truong';
export const AHA_OOS_FUB_TAG = 'OOS Referral';

/** Resolve the coordinator in the verified account; never fall back to the paired agent. */
export function resolveOosFubMapping(users: readonly { id: number; name: string }[]): VerifiedAgentMapping {
  const matches = users.filter((user) =>
    user.name.trim().replace(/\s+/g, ' ').toLowerCase() === AHA_OOS_FUB_ASSIGNEE.toLowerCase()
    && Number.isSafeInteger(user.id) && user.id > 0,
  );
  if (matches.length === 0) return { state: 'missing' };
  if (matches.length !== 1) return { state: 'ambiguous' };
  return { state: 'ready', fubUserId: matches[0].id };
}

export type IntakeFieldSource = {
  source?: string | null;
  loanFileNumber?: string | null;
  lookingInZip?: string | null;
  lookingInZips?: readonly string[] | null;
  borrowerCurrentAddress?: string | null;
  loanType?: string | null;
  stageOnTransfer?: string | null;
};

export type MockFubNoteInput = {
  key: string;
  label: string;
  body: string;
};

export function resolveVerifiedAgentMapping(
  links: readonly AgentFubMapping[],
  selectedAgentId: string,
): VerifiedAgentMapping {
  const selected = links.filter(
    (link) =>
      link.agentId === selectedAgentId &&
      Number.isSafeInteger(link.fubUserId) &&
      link.fubUserId > 0 &&
      link.auditedFubUserId === link.fubUserId,
  );
  if (selected.length === 0) return { state: 'missing' };
  if (selected.length > 1) return { state: 'ambiguous' };

  const fubUserId = selected[0].fubUserId;
  const claimedByAnotherAgent = links.some(
    (link) =>
      link.agentId !== selectedAgentId &&
      link.fubUserId === fubUserId &&
      link.auditedFubUserId === link.fubUserId,
  );
  return claimedByAnotherAgent
    ? { state: 'ambiguous' }
    : { state: 'ready', fubUserId };
}

function addNonEmpty(
  target: Record<string, string>,
  key: string,
  value: string | null | undefined,
): void {
  const normalized = value?.trim();
  if (normalized) target[key] = normalized;
}

export function buildFubIntakeFields(
  source: IntakeFieldSource,
): Record<string, string> {
  const fields: Record<string, string> = {};
  addNonEmpty(fields, 'referrioSource', source.source);
  addNonEmpty(fields, 'referrioLoanFileNumber', source.loanFileNumber);
  addNonEmpty(fields, 'referrioLookingInZip', source.lookingInZip);
  addNonEmpty(
    fields,
    'referrioLookingInZips',
    source.lookingInZips?.map((zip) => zip.trim()).filter(Boolean).join(', '),
  );
  addNonEmpty(
    fields,
    'referrioBorrowerCurrentAddress',
    source.borrowerCurrentAddress,
  );
  addNonEmpty(fields, 'referrioLoanType', source.loanType);
  addNonEmpty(fields, 'referrioStageOnTransfer', source.stageOnTransfer);
  return fields;
}

export function mergeEmptyFubFields(
  existing: Readonly<Record<string, string | null | undefined>>,
  incoming: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (typeof value === 'string') merged[key] = value;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (!merged[key]?.trim()) merged[key] = value;
  }
  return merged;
}

export function buildFubIntakeSummary(input: {
  referralId: string;
  customerName: string;
  selectedAgentName: string;
  selectionSource: 'auto' | 'manual';
  fields: Readonly<Record<string, string>>;
}): MockFubNoteInput {
  const selectionLabel =
    input.selectionSource === 'manual'
      ? `${input.selectedAgentName} (manual override)`
      : input.selectedAgentName;
  const fieldLines = Object.entries(input.fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
  return {
    key: `referrio-aha-intake:${input.referralId}`,
    label: 'Referrio AHA intake summary',
    body: [
      `Customer: ${input.customerName}`,
      `Selected agent: ${selectionLabel}`,
      fieldLines,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}
