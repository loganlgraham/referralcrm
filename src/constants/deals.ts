export const DEAL_STATUS_VALUES = [
  'under_contract',
  'past_inspection',
  'past_appraisal',
  'clear_to_close',
  'closed',
  'payment_sent',
  'paid',
  'terminated'
] as const;

export type DealStatus = (typeof DEAL_STATUS_VALUES)[number];

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  under_contract: 'Under Contract',
  past_inspection: 'Past Inspection',
  past_appraisal: 'Past Appraisal',
  clear_to_close: 'Clear to Close',
  closed: 'Closed',
  payment_sent: 'Payment Sent',
  paid: 'Payment Received',
  terminated: 'Terminated'
};

export const DEAL_STATUS_OPTIONS = DEAL_STATUS_VALUES.map((value) => ({
  value,
  label: DEAL_STATUS_LABELS[value]
}));
