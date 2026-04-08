import { z } from 'zod';
import { REFERRAL_STATUSES, REFERRAL_STATUS_VALUES, REFERRAL_TIMELINE_VALUES } from '@/constants/referrals';
import { DEAL_STATUS_VALUES, TERMINATED_REASON_VALUES } from '@/constants/deals';

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
  stageOnTransfer: z.enum(['Pre-approval TBD', 'Pre-approved']),
  loanFileNumber: z.string().optional(),
  initialNotes: z.string().optional(),
  loanType: z.string().optional(),
  preApprovalAmount: z.number().optional(),
  timeline: z.enum(REFERRAL_TIMELINE_VALUES).optional()
});

export const updateReferralSchema = z.object({
  status: z.enum(REFERRAL_STATUS_VALUES).optional(),
  buyStatus: z.enum(REFERRAL_STATUS_VALUES).optional(),
  sellStatus: z.enum(REFERRAL_STATUS_VALUES).optional(),
  terminatedReason: z.enum(TERMINATED_REASON_VALUES).nullable().optional(),
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
  loanType: z.string().optional(),
  preApprovalAmount: z.number().min(0).optional(),
  timeline: z.enum(REFERRAL_TIMELINE_VALUES).optional(),
  referralDate: z.union([z.string().datetime(), z.null()]).optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'Terminated' && !data.terminatedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Terminated reason is required when status is Terminated.',
      path: ['terminatedReason'],
    });
  }
});

export const createActivitySchema = z.object({
  channel: z.enum(['call', 'sms', 'email', 'note', 'status', 'update']),
  content: z.string().min(1)
});

export const assignAgentSchema = z.object({
  agentId: z.string().min(1),
  side: z.enum(['buy', 'sell']).optional()
});

export const assignLenderSchema = z.object({
  lenderId: z.string().min(1)
});

export const updateStatusSchema = z.object({
  status: z.enum(REFERRAL_STATUS_VALUES),
  side: z.enum(['buy', 'sell']).optional(),
  source: z.enum(['referral_table', 'referral_detail']).optional(),
  terminatedReason: z.enum(TERMINATED_REASON_VALUES).nullable().optional(),
  closingDate: z.string().optional(),
  sendClosedEmails: z.boolean().optional(),
  sendAgentNpsEmail: z.boolean().optional(),
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
    .optional(),
  createNewDeal: z.boolean().optional()
}).superRefine((data, ctx) => {
  if (data.status === 'Terminated' && !data.terminatedReason) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Terminated reason is required when status is Terminated.',
      path: ['terminatedReason'],
    });
  }
});

export const createReferralNoteSchema = z.object({
  content: z.string().min(1),
  hiddenFromAgent: z.boolean().optional(),
  hiddenFromMc: z.boolean().optional(),
  emailTargets: z.array(z.enum(['agent', 'mc', 'admin'])).optional()
});

export const updateReferralNoteSchema = z.object({
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
  status: z.enum(DEAL_STATUS_VALUES).default('under_contract'),
  expectedAmountCents: z.number().int().min(0),
  receivedAmountCents: z.number().int().min(0).optional(),
  terminatedReason: z.enum(TERMINATED_REASON_VALUES).nullable().optional(),
  agentAttribution: z.enum(['AHA', 'AHA_OOS', 'OUTSIDE_AGENT']).nullable().optional(),
  agentId: z
    .union([z.string().trim().regex(/^[0-9a-fA-F]{24}$/), z.literal(null)])
    .optional(),
  usedAfc: z.boolean().optional(),
  usedAssignedAgent: z.boolean().optional(),
  invoiceDate: z.string().optional(),
  paidDate: z.string().optional(),
  closingDate: z.string().nullable().optional(),
  underContractDate: z.string().nullable().optional(),
  notes: z.string().optional(),
  side: z.enum(['buy', 'sell']).optional(),
  commissionBasisPoints: z.number().int().min(0).nullable().optional(),
  commissionFlatFeeCents: z.number().int().min(0).nullable().optional(),
  referralFeeBasisPoints: z.number().int().min(0).nullable().optional(),
  contractPriceCents: z.number().int().min(0).nullable().optional(),
  netReferralFeePaidCents: z.number().int().min(0).optional(),
  propertyAddress: z.union([z.string().trim().min(1), z.null()]).optional(),
  propertyCity: z.union([z.string().trim().min(1), z.null()]).optional(),
  propertyState: z
    .union([
      z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/)
        .transform((value) => value.toUpperCase()),
      z.null()
    ])
    .optional(),
  sendClosedEmails: z.boolean().optional(),
  sendAgentNpsEmail: z.boolean().optional()
});
