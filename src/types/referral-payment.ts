export interface ReferralPayment {
  _id: string;
  status?: string | null;
  expectedAmountCents?: number | null;
  receivedAmountCents?: number | null;
  invoiceDate?: string | null;
  paidDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  terminatedReason?: string | null;
  agentAttribution?: string | null;
  usedAfc?: boolean;
  usedAssignedAgent?: boolean;
  commissionBasisPoints?: number | null;
  referralFeeBasisPoints?: number | null;
  side?: 'buy' | 'sell' | null;
  contractPriceCents?: number | null;
  netReferralFeePaidCents?: number | null;
  propertyAddress?: string | null;
  closingDate?: string | null;
  agent?: { id: string; name: string | null } | null;
  agentId?: string | null;
}
