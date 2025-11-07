import { z } from 'zod';
import { REFERRAL_STATUSES } from '@/constants/referrals';

export const createReferralSchema = z.object({
  borrowerName: z.string().min(1),
  borrowerEmail: z.string().email(),
  borrowerPhone: z.string().min(7),
  propertyZip: z.string().min(5),
  source: z.enum(['Lender', 'MC']),
  loanType: z.string().optional(),
  estPurchasePrice: z.number().optional()
});

export const updateReferralSchema = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  assignedAgent: z.string().optional(),
  referralFeeBasisPoints: z.number().int().min(0).optional()
});

export const createActivitySchema = z.object({
  channel: z.enum(['call', 'sms', 'email', 'note']),
  content: z.string().min(1)
});

export const assignAgentSchema = z.object({
  agentId: z.string().min(1)
});

export const assignLenderSchema = z.object({
  lenderId: z.string().min(1)
});

export const updateStatusSchema = z.object({
  status: z.enum(REFERRAL_STATUSES),
  contractDetails: z
    .object({
      propertyAddress: z.string().min(1),
      contractPrice: z.number().min(0),
      agentCommissionPercentage: z.number().min(0),
      referralFeePercentage: z.number().min(0)
    })
    .optional()
});

export const createReferralNoteSchema = z.object({
  content: z.string().min(1),
  hiddenFromAgent: z.boolean().optional(),
  hiddenFromMc: z.boolean().optional()
});

export const createAgentNoteSchema = z.object({
  content: z.string().min(1)
});

export const createLenderNoteSchema = z.object({
  content: z.string().min(1)
});

export const paymentSchema = z.object({
  referralId: z.string().min(1),
  status: z.enum(['under_contract', 'closed', 'paid', 'terminated']).default('under_contract'),
  expectedAmountCents: z.number().int().min(0),
  receivedAmountCents: z.number().int().min(0).optional(),
  invoiceDate: z.string().optional(),
  paidDate: z.string().optional(),
  notes: z.string().optional()
});
