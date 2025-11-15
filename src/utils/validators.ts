import { z } from 'zod';
import { REFERRAL_STATUSES } from '@/constants/referrals';

const zipArraySchema = z
  .array(z.string().trim().regex(/^\d{5}$/))
  .transform((zipCodes) => Array.from(new Set(zipCodes)));

export const createReferralSchema = z.object({
  borrowerFirstName: z.string().min(1),
  borrowerLastName: z.string().min(1),
  borrowerEmail: z.string().email(),
  borrowerPhone: z.string().min(7),
  source: z.string().trim().min(1).optional(),
  endorser: z.string().trim().min(1).optional(),
  clientType: z.enum(['Seller', 'Buyer', 'Both']),
  lookingInZip: z.string().regex(/^\d{5}$/),
  lookingInZips: zipArraySchema.optional(),
  borrowerCurrentAddress: z.string().min(1),
  stageOnTransfer: z.enum(['Pre-Approval TBD', 'Pre-Approval']),
  loanFileNumber: z.string().min(1),
  initialNotes: z.string().optional(),
  loanType: z.string().optional(),
  preApprovalAmount: z.number().optional()
});

export const updateReferralSchema = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  assignedAgent: z.string().optional(),
  referralFeeBasisPoints: z.number().int().min(0).optional(),
  ahaBucket: z.enum(['AHA', 'AHA_OOS']).nullable().optional(),
  source: z.string().trim().min(1).optional(),
  endorser: z.string().trim().min(1).optional(),
  clientType: z.enum(['Seller', 'Buyer', 'Both']).optional(),
  lookingInZip: z.string().regex(/^\d{5}$/).optional(),
  lookingInZips: zipArraySchema.optional(),
  borrowerCurrentAddress: z.string().min(1).optional(),
  stageOnTransfer: z.string().min(1).optional(),
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
      referralFeePercentage: z.number().min(0),
      dealSide: z.enum(['buy', 'sell'])
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
    .enum([
      'under_contract',
      'past_inspection',
      'past_appraisal',
      'clear_to_close',
      'closed',
      'payment_sent',
      'paid',
      'terminated',
    ])
    .default('under_contract'),
  expectedAmountCents: z.number().int().min(0),
  receivedAmountCents: z.number().int().min(0).optional(),
  terminatedReason: z
    .enum(['inspection', 'appraisal', 'financing', 'changed_mind'])
    .nullable()
    .optional(),
  agentAttribution: z.enum(['AHA', 'AHA_OOS', 'OUTSIDE_AGENT']).nullable().optional(),
  usedAfc: z.boolean().optional(),
  usedAssignedAgent: z.boolean().optional(),
  invoiceDate: z.string().optional(),
  paidDate: z.string().optional(),
  notes: z.string().optional(),
  side: z.enum(['buy', 'sell']).optional(),
  commissionBasisPoints: z.number().int().min(0).optional(),
  referralFeeBasisPoints: z.number().int().min(0).optional(),
  contractPriceCents: z.number().int().min(0).optional()
});
