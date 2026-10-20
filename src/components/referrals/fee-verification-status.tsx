import type { FeeBreakdownVerificationStatus } from '@/lib/fee-verification';
import { formatDateTimeMST } from '@/utils/formatters';

export type FeeVerificationStatusTone = 'muted' | 'success' | 'warning';

export function describeFeeVerificationStatus(
  status?: FeeBreakdownVerificationStatus | null,
  verifiedAt?: string | null
): { tone: FeeVerificationStatusTone; text: string } | null {
  if (!status) {
    return null;
  }
  const when = verifiedAt ? ` ${formatDateTimeMST(verifiedAt)}` : '';
  switch (status) {
    case 'pending':
      return { tone: 'muted', text: 'Waiting on agent to confirm the numbers' };
    case 'confirmed':
      return { tone: 'success', text: `Agent confirmed numbers${when}` };
    case 'disputed':
      return { tone: 'warning', text: `Agent reported an issue${when} (see activity timeline)` };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

const TONE_CLASS: Record<FeeVerificationStatusTone, string> = {
  muted: 'text-foreground-subtle',
  success: 'text-success',
  warning: 'font-semibold text-warning',
};

interface FeeVerificationStatusLineProps {
  status?: FeeBreakdownVerificationStatus | null;
  verifiedAt?: string | null;
}

export function FeeVerificationStatusLine({ status, verifiedAt }: FeeVerificationStatusLineProps) {
  const described = describeFeeVerificationStatus(status, verifiedAt);
  if (!described) {
    return null;
  }
  return <p className={`text-xs ${TONE_CLASS[described.tone]}`}>{described.text}</p>;
}
