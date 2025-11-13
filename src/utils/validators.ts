import { z } from 'zod';
import { REFERRAL_STATUSES } from '@/constants/referrals';

export const createReferralSchema = z.object({
  borrowerName: z.string().min(1),
  borrowerEmail: z.string().email(),
  borrowerPhone: z.string().min(7),
  source: z.enum(['Lender', 'MC']),
  endorser: z.string().min(1),
  clientType: z.enum(['Seller', 'Buyer']),
  lookingInZip: z.string().min(5),
  borrowerCurrentAddress: z.string().min(1),
  stageOnTransfer: z.string().min(1),
  loanFileNumber: z.string().min(1),
  initialNotes: z.string().optional(),
  loanType: z.string().optional(),
  estPurchasePrice: z.number().optional()
});

export const updateReferralSchema = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  assignedAgent: z.string().optional(),
  referralFeeBasisPoints: z.number().int().min(0).optional(),
  ahaBucket: z.enum(['AHA', 'AHA_OOS']).nullable().optional(),
  source: z.enum(['Lender', 'MC']).optional(),
  endorser: z.string().min(1).optional(),
  clientType: z.enum(['Seller', 'Buyer']).optional(),
  lookingInZip: z.string().min(5).optional(),
  borrowerCurrentAddress: z.string().min(1).optional(),
  stageOnTransfer: z.string().min(1).optional(),
  initialNotes: z.string().optional(),
  loanFileNumber: z.string().min(1).optional(),
});

export const createActivitySchema = z.object({
  channel: z.enum(['call', 'sms', 'email', 'note', 'status', 'update']),
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
      propertyCity: z.string().min(1),
      propertyState: z
        .string()
        .regex(/^[A-Za-z]{2}$/)
        .transform((value) => value.toUpperCase()),
      propertyPostalCode: z
        .string()
        .regex(/^\d{5}(?:-\d{4})?$/, 'Enter a valid ZIP code'),
      contractPrice: z.number().min(0),
      agentCommissionPercentage: z.number().min(0),
      referralFeePercentage: z.number().min(0)
    })
    .optional()
});

export const createReferralNoteSchema = z.object({
  content: z.string().min(1),
  hiddenFromAgent: z.boolean().optional(),
  hiddenFromMc: z.boolean().optional(),
  emailTargets: z.array(z.enum(['agent', 'mc', 'admin'])).optional()
});

export const createAgentNoteSchema = z.object({
  content: z.string().min(1)
});

export const createLenderNoteSchema = z.object({
  content: z.string().min(1)
});

export const paymentSchema = z.object({
  referralId: z.string().min(1),
  status: z
    .enum(['under_contract', 'closed', 'payment_sent', 'paid', 'terminated'])
    .default('under_contract'),
  expectedAmountCents: z.number().int().min(0),
  receivedAmountCents: z.number().int().min(0).optional(),
  terminatedReason: z
    .enum(['inspection', 'appraisal', 'financing', 'changed_mind'])
    .nullable()
    .optional(),
  agentAttribution: z.enum(['AHA', 'AHA_OOS', 'OUTSIDE_AGENT']).nullable().optional(),
  usedAfc: z.boolean().optional(),
  invoiceDate: z.string().optional(),
  paidDate: z.string().optional(),
  notes: z.string().optional()
});
