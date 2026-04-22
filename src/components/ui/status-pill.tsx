import { Badge, type BadgeProps, type BadgeVariant } from '@/components/ui/badge';
import { DEAL_STATUS_LABELS, type DealStatus } from '@/constants/deals';
import type { ReferralStatus } from '@/constants/referrals';

const referralVariantByStatus: Record<ReferralStatus, BadgeVariant> = {
  'New Lead': 'info',
  Paired: 'info',
  'In Communication': 'warning',
  'Active Lead': 'accent',
  'Under Contract': 'warning',
  Closed: 'success',
  Lost: 'danger',
  Terminated: 'danger'
};

const dealVariantByStatus: Record<DealStatus, BadgeVariant> = {
  under_contract: 'warning',
  past_inspection: 'info',
  past_appraisal: 'info',
  clear_to_close: 'accent',
  closed: 'success',
  payment_sent: 'progress',
  paid: 'success',
  terminated: 'danger'
};

/**
 * Resolve a variant from any human-readable status label. Covers both
 * referral statuses and deal status labels so tables that mix the two can
 * render a single pill component.
 */
const labelVariant: Record<string, BadgeVariant> = {
  ...Object.fromEntries(
    (Object.entries(referralVariantByStatus) as [ReferralStatus, BadgeVariant][]).map(([k, v]) => [k, v])
  ),
  'Showing Homes': 'accent',
  'Past Inspection': 'info',
  'Past Appraisal': 'info',
  'Clear to Close': 'accent',
  'Payment Sent': 'progress',
  'Payment Received': 'success',
  Paid: 'success'
};

type ReferralStatusPillProps = Omit<BadgeProps, 'variant' | 'children'> & {
  kind?: 'referral';
  status: ReferralStatus | 'Showing Homes';
  label?: string;
};

type DealStatusPillProps = Omit<BadgeProps, 'variant' | 'children'> & {
  kind: 'deal';
  status: DealStatus;
  label?: string;
};

type AutoStatusPillProps = Omit<BadgeProps, 'variant' | 'children'> & {
  kind: 'auto';
  /** Free-form status label (referral or deal). Falls back to neutral if unknown. */
  status: string;
  label?: string;
};

export type StatusPillProps = ReferralStatusPillProps | DealStatusPillProps | AutoStatusPillProps;

const normalizeReferralStatus = (
  status: ReferralStatus | 'Showing Homes'
): ReferralStatus => (status === 'Showing Homes' ? 'Active Lead' : status);

export function StatusPill(props: StatusPillProps) {
  if (props.kind === 'deal') {
    const { kind: _ignored, status, label, size = 'md', ...rest } = props;
    void _ignored;
    return (
      <Badge variant={dealVariantByStatus[status]} size={size} {...rest}>
        {label ?? DEAL_STATUS_LABELS[status] ?? status}
      </Badge>
    );
  }

  if (props.kind === 'auto') {
    const { kind: _ignored, status, label, size = 'md', ...rest } = props;
    void _ignored;
    const variant = labelVariant[status] ?? 'neutral';
    return (
      <Badge variant={variant} size={size} {...rest}>
        {label ?? status}
      </Badge>
    );
  }

  const { kind: _ignored, status, label, size = 'md', ...rest } = props;
  void _ignored;
  const normalized = normalizeReferralStatus(status);
  return (
    <Badge variant={referralVariantByStatus[normalized]} size={size} {...rest}>
      {label ?? status}
    </Badge>
  );
}
