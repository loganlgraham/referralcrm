import { z } from 'zod';
import { REFERRAL_STATUSES } from '@/models/referral';

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
  notes: z.string().optional(),
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

export const updateStatusSchema = z.object({
  status: z.enum(REFERRAL_STATUSES)
});

export const paymentSchema = z.object({
  referralId: z.string().min(1),
  status: z.enum(['expected', 'invoiced', 'paid', 'writtenOff']).default('expected'),
  expectedAmountCents: z.number().int().min(0),
  receivedAmountCents: z.number().int().min(0).optional(),
  invoiceDate: z.string().optional(),
  paidDate: z.string().optional(),
  notes: z.string().optional()
});
