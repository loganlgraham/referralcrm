type DealStatusSource = {
  referralId: { toString(): string } | string;
  status?: string | null;
  usedAssignedAgent?: boolean | null;
  agentAttribution?: string | null;
};

export const isAgentAttributedDeal = (payment: DealStatusSource): boolean =>
  payment.usedAssignedAgent === true && payment.agentAttribution !== 'OUTSIDE_AGENT';

export const buildDealStatusMap = (payments: DealStatusSource[]) => {
  const dealStatusMap = new Map<string, { primary?: string; fallback?: string }>();

  for (const payment of payments) {
    const status = typeof payment.status === 'string' ? payment.status : null;
    if (!status || !isAgentAttributedDeal(payment)) {
      continue;
    }

    const key =
      typeof payment.referralId === 'string'
        ? payment.referralId
        : payment.referralId.toString();
    const record = dealStatusMap.get(key) ?? {};
    if (!record.fallback) {
      record.fallback = status;
    }
    if (!record.primary && status !== 'terminated') {
      record.primary = status;
    }
    dealStatusMap.set(key, record);
  }

  return dealStatusMap;
};
