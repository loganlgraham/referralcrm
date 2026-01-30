import type { ReferralStatus } from '@/constants/referrals';
import type { AdminTaskCategory, AdminTaskPriority } from '@/models/admin-task';

/** Timeline values that count as "≥ 6 months" for long-term check-in cadence */
const LONG_TERM_TIMELINES = new Set(['6-12_months', '12+_months']);

/** Timeline values that count as "< 6 months" (default if null/empty) */
const SHORT_TERM_TIMELINES = new Set(['asap', '1-3_months', '3-6_months', 'not_specified']);

export function isTimelineLongTerm(timeline: string | null | undefined): boolean {
  if (!timeline) return false;
  return LONG_TERM_TIMELINES.has(timeline);
}

export function isTimelineShortTerm(timeline: string | null | undefined): boolean {
  if (!timeline) return true; // default if null/empty
  return SHORT_TERM_TIMELINES.has(timeline);
}

export interface TaskRuleDefinition {
  ruleKey: string;
  title: string;
  description?: string;
  category?: AdminTaskCategory;
  priority?: AdminTaskPriority;
  /** Days offset from base date (status entry or referral creation) */
  dueOffsetDays: number;
  /** Status(es) this rule applies to */
  statuses: ReferralStatus[];
  /** For In Communication: 'short' = one-time cadence, 'long' = recurring 30-day */
  timelineVariant?: 'short' | 'long';
  /** 'once' for one-time tasks, 'month' for recurring (cycleKey = YYYY-MM) */
  cycleType: 'once' | 'month';
}

/** Global rule on referral created */
export const GLOBAL_ON_CREATED_RULES: TaskRuleDefinition[] = [
  {
    ruleKey: 'assign_agent_paired',
    title: 'Assign Agent → set status to Paired',
    category: 'assignment',
    priority: 'high',
    dueOffsetDays: 0,
    statuses: ['New Lead'],
    cycleType: 'once',
  },
];

/** Rules for Paired status */
export const PAIRED_RULES: TaskRuleDefinition[] = [
  {
    ruleKey: 'add_agent_homebot',
    title: 'Add Real Estate Agent to Homebot',
    category: 'communication',
    dueOffsetDays: 0,
    statuses: ['Paired'],
    cycleType: 'once',
  },
  {
    ruleKey: 'check_in_agent_connected',
    title: 'Check in: has agent connected with buyer?',
    category: 'communication',
    dueOffsetDays: 1,
    statuses: ['Paired'],
    cycleType: 'once',
  },
];

/** Rules for In Communication with short timeline (< 6 months) */
export const IN_COMMUNICATION_SHORT_RULES: TaskRuleDefinition[] = [
  {
    ruleKey: 'check_in_week_1',
    title: 'Check in – Week 1',
    category: 'communication',
    dueOffsetDays: 7,
    statuses: ['In Communication'],
    timelineVariant: 'short',
    cycleType: 'once',
  },
  {
    ruleKey: 'check_in_week_2',
    title: 'Check in – Week 2',
    category: 'communication',
    dueOffsetDays: 14,
    statuses: ['In Communication'],
    timelineVariant: 'short',
    cycleType: 'once',
  },
  {
    ruleKey: 'check_in_ongoing_momentum',
    title: 'Check in – Ongoing momentum',
    category: 'communication',
    dueOffsetDays: 30,
    statuses: ['In Communication'],
    timelineVariant: 'short',
    cycleType: 'once',
  },
];

/** Rules for In Communication with long timeline (≥ 6 months) - recurring */
export const IN_COMMUNICATION_LONG_RULES: TaskRuleDefinition[] = [
  {
    ruleKey: 'long_term_check_in',
    title: 'Long-term check-in every 30 days',
    category: 'communication',
    dueOffsetDays: 30,
    statuses: ['In Communication'],
    timelineVariant: 'long',
    cycleType: 'month',
  },
];

/** Rules for Active Lead - weekly check-ins */
export const ACTIVE_LEAD_RULES: TaskRuleDefinition[] = [
  {
    ruleKey: 'active_lead_check_in_week_1',
    title: 'Active Lead Check-in – Week 1',
    category: 'communication',
    dueOffsetDays: 7,
    statuses: ['Active Lead'],
    cycleType: 'once',
  },
  {
    ruleKey: 'active_lead_check_in_week_2',
    title: 'Active Lead Check-in – Week 2',
    category: 'communication',
    dueOffsetDays: 14,
    statuses: ['Active Lead'],
    cycleType: 'once',
  },
  {
    ruleKey: 'active_lead_check_in_week_3',
    title: 'Active Lead Check-in – Week 3',
    category: 'communication',
    dueOffsetDays: 21,
    statuses: ['Active Lead'],
    cycleType: 'once',
  },
  {
    ruleKey: 'active_lead_check_in_week_4',
    title: 'Active Lead Check-in – Week 4',
    category: 'communication',
    dueOffsetDays: 28,
    statuses: ['Active Lead'],
    cycleType: 'once',
  },
];

/** Rules for Under Contract - one-time */
export const UNDER_CONTRACT_RULES: TaskRuleDefinition[] = [
  { ruleKey: 'uc_update_realtor_audit', title: 'Update Realtor Audit Spreadsheet', category: 'ops', dueOffsetDays: 0, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_congratulations_agent', title: 'UC Congratulations – Agent', category: 'communication', dueOffsetDays: 0, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_save_contract_gdrive', title: 'Save Contract in GDrive folder', category: 'ops', dueOffsetDays: 0, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_check_in_midway', title: 'Check in UC – Midway', category: 'communication', dueOffsetDays: 10, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_confirm_cda_w9_wiring', title: 'Confirm CDA / W9 / Wiring instructions were sent', category: 'finance', dueOffsetDays: 23, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_call_confirm_closing', title: 'Call and Confirm Closing is still on', category: 'communication', dueOffsetDays: 27, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_change_deal_closed', title: 'Change Deal to Closed (Ensure closing date is correct)', category: 'ops', dueOffsetDays: 31, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_update_49_agents_map', title: 'Update 49 Agents map – yellow', category: 'ops', dueOffsetDays: 31, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_congrats_call_post_closing', title: 'Congrats call and Post Closing card – Agent/Buyer', category: 'communication', dueOffsetDays: 31, statuses: ['Under Contract'], cycleType: 'once' },
  { ruleKey: 'uc_confirm_referral_fee', title: 'Confirm receipt of referral fee', category: 'finance', dueOffsetDays: 40, statuses: ['Under Contract'], cycleType: 'once' },
];
