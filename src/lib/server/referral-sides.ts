import { normalizeReferralStatus, type ReferralStatus } from '@/constants/referrals';

type ReferralAgentRef =
  | string
  | { _id?: string | { toString(): string } | null; toString?: () => string }
  | null
  | undefined;

type ReferralSideSource = {
  buySideAgent?: ReferralAgentRef;
  sellSideAgent?: ReferralAgentRef;
  assignedAgent?: ReferralAgentRef;
  dealSide?: 'buy' | 'sell' | null;
  clientType?: 'Seller' | 'Buyer' | 'Both' | string | null;
  buyStatus?: ReferralStatus | null;
  sellStatus?: ReferralStatus | null;
};

export type ReferralSide = 'buy' | 'sell';

const ACTIVE_PROGRESS_ORDER: ReferralStatus[] = [
  'Closed',
  'Under Contract',
  'Active Lead',
  'In Communication',
  'Paired',
  'New Lead',
];

const toId = (value: ReferralAgentRef): string | null => {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && value._id) {
    const rawId = value._id;
    if (typeof rawId === 'string') {
      return rawId;
    }
    if (typeof rawId?.toString === 'function') {
      return rawId.toString();
    }
  }
  if (typeof (value as { toString?: () => string }).toString === 'function') {
    return (value as { toString: () => string }).toString();
  }
  return null;
};

export const resolveAgentSideForReferral = (
  referral: ReferralSideSource,
  sessionAgentId: string | null | undefined
): ReferralSide | null => {
  const normalizedAgentId = sessionAgentId ?? null;
  if (!normalizedAgentId) {
    return null;
  }

  const buySideAgentId = toId(referral.buySideAgent);
  if (buySideAgentId === normalizedAgentId) {
    return 'buy';
  }

  const sellSideAgentId = toId(referral.sellSideAgent);
  if (sellSideAgentId === normalizedAgentId) {
    return 'sell';
  }

  return null;
};

export const pickPrimarySideForReferral = (referral: ReferralSideSource): ReferralSide => {
  if (referral.dealSide === 'sell') {
    return 'sell';
  }
  if (referral.dealSide === 'buy') {
    return 'buy';
  }

  if (referral.clientType === 'Seller') {
    return 'sell';
  }

  const hasBuy = Boolean(toId(referral.buySideAgent));
  const hasSell = Boolean(toId(referral.sellSideAgent));
  if (!hasBuy && hasSell) {
    return 'sell';
  }

  return 'buy';
};

export const getAgentIdForSide = (
  referral: ReferralSideSource,
  side: ReferralSide
): string | null => {
  if (side === 'sell') {
    return toId(referral.sellSideAgent) ?? toId(referral.assignedAgent);
  }
  return toId(referral.buySideAgent) ?? toId(referral.assignedAgent);
};

export const deriveReferralStatusFromSides = (
  buyStatusRaw?: string | null,
  sellStatusRaw?: string | null,
  clientType?: string | null
): ReferralStatus => {
  const buyStatus = normalizeReferralStatus(buyStatusRaw);
  const sellStatus = normalizeReferralStatus(sellStatusRaw);

  if (clientType === 'Buyer') {
    return buyStatus ?? sellStatus ?? 'New Lead';
  }
  if (clientType === 'Seller') {
    return sellStatus ?? buyStatus ?? 'New Lead';
  }

  const statuses = [buyStatus, sellStatus].filter((value): value is ReferralStatus => Boolean(value));

  for (const candidate of ACTIVE_PROGRESS_ORDER) {
    if (statuses.includes(candidate)) {
      return candidate;
    }
  }

  if (buyStatus === 'Terminated' && sellStatus === 'Terminated') {
    return 'Terminated';
  }
  if (
    (buyStatus === 'Lost' || buyStatus === 'Terminated') &&
    (sellStatus === 'Lost' || sellStatus === 'Terminated')
  ) {
    return 'Lost';
  }

  return buyStatus ?? sellStatus ?? 'New Lead';
};
