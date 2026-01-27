/**
 * Task Rules Definition
 *
 * This file defines all static task rules for referrals and agents.
 * Tasks are only created for OOS (Out-of-State) referrals unless otherwise specified.
 */

import type { ReferralTimeline } from '@/constants/referrals';
import type { FollowUpTaskType, FollowUpTaskCategory } from '@/models/follow-up-task';

// Timeline classifications
// < 6 months: asap, 1-3_months, 3-6_months → SHORT cadence (Week 1/2/4/8)
// >= 6 months: 6-12_months, 12+_months, not_specified → LONG cadence (30/60/90 day)
export const SHORT_TIMELINE_VALUES: ReferralTimeline[] = ['asap', '1-3_months', '3-6_months'];
export const LONG_TIMELINE_VALUES: ReferralTimeline[] = ['6-12_months', '12+_months', 'not_specified'];

/**
 * Check if referral has OOS agent assigned.
 * OOS = ahaBucket is 'AHA_OOS' OR has an attached agent with ahaDesignation === 'AHA_OOS'
 */
export function isOOSReferral(
  ahaBucket: string | null | undefined,
  hasAhaOosAgentAttached?: boolean
): boolean {
  return ahaBucket === 'AHA_OOS' || hasAhaOosAgentAttached === true;
}

/**
 * Check if timeline is "short" (< 6 months)
 * Short timeline uses WEEK cadence for In Communication tasks (Week 1/2/4/8)
 */
export function isShortTimeline(timeline: ReferralTimeline | null | undefined): boolean {
  if (!timeline) return false;
  return SHORT_TIMELINE_VALUES.includes(timeline);
}

/**
 * Check if timeline is "long" (>= 6 months or not specified)
 * Long timeline uses MONTHLY cadence for In Communication tasks (30/60/90 day)
 */
export function isLongTimeline(timeline: ReferralTimeline | null | undefined): boolean {
  if (!timeline) return true; // Default to long timeline if not specified
  return LONG_TIMELINE_VALUES.includes(timeline);
}

export interface TaskRuleDefinition {
  ruleId: string;
  title: string;
  type: FollowUpTaskType;
  message: string;
  category: FollowUpTaskCategory;
  dueOffset: { days?: number; months?: number };
  // If true, task is only created for OOS referrals
  oosOnly?: boolean;
  // Timeline condition: 'short' | 'long' | undefined (no condition)
  timelineCondition?: 'short' | 'long';
}

// =============================================================================
// REFERRAL TASK RULES
// =============================================================================

/**
 * CREATED_TASKS - Always created on referral creation (regardless of OOS status)
 */
export const CREATED_TASKS: TaskRuleDefinition[] = [
  {
    ruleId: 'created::assign-agent',
    title: 'Assign Agent - Change Status to Paired',
    type: 'Task',
    message: 'Assign an agent to this referral and change status to Paired.',
    category: 'ops',
    dueOffset: { days: 0 },
    oosOnly: false, // Always created, regardless of OOS
  },
];

/**
 * PAIRED_TASKS - When moved to Paired status (OOS only)
 */
export const PAIRED_TASKS: TaskRuleDefinition[] = [
  {
    ruleId: 'paired::homebot-add',
    title: 'Add Real Estate Agent In Home Bot to Client Page',
    type: 'Task',
    message: 'Add the real estate agent to the client page in Homebot.',
    category: 'ops',
    dueOffset: { days: 0 },
    oosOnly: true,
  },
  {
    ruleId: 'paired::check-agent-connected',
    title: 'Check in - Agent connected with Buyer?',
    type: 'Call',
    message: 'Check in to confirm the agent has connected with the buyer.',
    category: 'communication',
    dueOffset: { days: 1 },
    oosOnly: true,
  },
];

/**
 * IN_COMMUNICATION_SHORT_TASKS - Timeline < 6 months (asap, 1-3, 3-6)
 * Uses WEEK cadence: Week 1, Week 2, Week 4, Week 8
 */
export const IN_COMMUNICATION_SHORT_TASKS: TaskRuleDefinition[] = [
  {
    ruleId: 'in-comm::week-1',
    title: 'Check in - Week 1',
    type: 'Call',
    message: 'Week 1 check-in with the client.',
    category: 'communication',
    dueOffset: { days: 7 },
    oosOnly: true,
    timelineCondition: 'short',
  },
  {
    ruleId: 'in-comm::week-2',
    title: 'Check in - Week 2',
    type: 'Email',
    message: 'Week 2 check-in with the client.',
    category: 'communication',
    dueOffset: { days: 14 },
    oosOnly: true,
    timelineCondition: 'short',
  },
  {
    ruleId: 'in-comm::week-4',
    title: 'Check in - Week 4 (1 month)',
    type: 'Call',
    message: 'One month check-in with the client.',
    category: 'communication',
    dueOffset: { days: 28 },
    oosOnly: true,
    timelineCondition: 'short',
  },
  {
    ruleId: 'in-comm::week-8',
    title: 'Check in - Week 8 (2 Months)',
    type: 'Email',
    message: 'Two month check-in with the client.',
    category: 'communication',
    dueOffset: { months: 2 },
    oosOnly: true,
    timelineCondition: 'short',
  },
];

/**
 * IN_COMMUNICATION_LONG_TASKS - Timeline >= 6 months (6-12, 12+, not_specified)
 * Uses MONTHLY cadence: 30 day, 60 day, 90 day
 */
export const IN_COMMUNICATION_LONG_TASKS: TaskRuleDefinition[] = [
  {
    ruleId: 'in-comm::30-day',
    title: 'Check in - 30 day',
    type: 'Call',
    message: '30 day check-in with the client.',
    category: 'communication',
    dueOffset: { months: 1 },
    oosOnly: true,
    timelineCondition: 'long',
  },
  {
    ruleId: 'in-comm::60-day',
    title: 'Check in - 60 day',
    type: 'Call',
    message: '60 day check-in with the client.',
    category: 'communication',
    dueOffset: { months: 2 },
    oosOnly: true,
    timelineCondition: 'long',
  },
  {
    ruleId: 'in-comm::90-day',
    title: 'Check in - 90 day',
    type: 'Call',
    message: '90 day check-in with the client.',
    category: 'communication',
    dueOffset: { months: 3 },
    oosOnly: true,
    timelineCondition: 'long',
  },
];

/**
 * UNDER_CONTRACT_TASKS - When status changes to Under Contract (OOS only)
 */
export const UNDER_CONTRACT_TASKS: TaskRuleDefinition[] = [
  {
    ruleId: 'under-contract::update-realtor-audit',
    title: 'Update Realtor Audit Spreadsheet (Deal 1)',
    type: 'Task',
    message: 'Update the Realtor Audit Spreadsheet with contract details.',
    category: 'ops',
    dueOffset: { days: 0 },
    oosOnly: true,
  },
  {
    ruleId: 'under-contract::uc-congratulations-agent',
    title: 'UC Congratulations - Agent',
    type: 'Call',
    message: 'Call the agent to congratulate them on getting under contract.',
    category: 'communication',
    dueOffset: { days: 0 },
    oosOnly: true,
  },
  {
    ruleId: 'under-contract::save-contract-gdrive',
    title: 'Save Contract in Gdrive folder (Deal 1)',
    type: 'Task',
    message: 'Save the contract documents to the Google Drive folder.',
    category: 'ops',
    dueOffset: { days: 0 },
    oosOnly: true,
  },
  {
    ruleId: 'under-contract::check-in-uc-midway',
    title: 'Check in UC - Midway (Deal 1)',
    type: 'Email',
    message: 'Midway check-in for the under contract deal.',
    category: 'communication',
    dueOffset: { days: 10 },
    oosOnly: true,
  },
  {
    ruleId: 'under-contract::confirm-closing-on-track',
    title: 'Call and Confirm Closing is still on (Deal 1)',
    type: 'Call',
    message: 'Call to confirm the closing date is still on track.',
    category: 'communication',
    dueOffset: { days: 29 },
    oosOnly: true,
  },
  {
    ruleId: 'under-contract::change-deal-closed',
    title: 'Change Deal to Closed (Deal 1)',
    type: 'Task',
    message: 'Change deal status to Closed and verify the closing date is correct.',
    category: 'ops',
    dueOffset: { days: 31 },
    oosOnly: true,
  },
];

/**
 * DEAL_CLOSED_TASKS - When DEAL status changes to 'closed' (OOS only)
 * These are triggered by deal status change, not referral status change
 */
export const DEAL_CLOSED_TASKS: TaskRuleDefinition[] = [
  {
    ruleId: 'deal-closed::update-49-agents-yellow',
    title: 'Update 49 Agents map - yellow',
    type: 'Task',
    message: 'Update the 49 Agents map to mark this deal as closed (yellow).',
    category: 'ops',
    dueOffset: { days: 0 },
    oosOnly: true,
  },
  {
    ruleId: 'deal-closed::post-closing-card',
    title: 'Post Closing card - Agent/Buyer',
    type: 'Task',
    message: 'Send post-closing card to both the agent and buyer.',
    category: 'communication',
    dueOffset: { days: 0 },
    oosOnly: true,
  },
];

// =============================================================================
// AGENT ONBOARDING TASK RULES
// =============================================================================

export const AGENT_ONBOARDING_TASKS: TaskRuleDefinition[] = [
  {
    ruleId: 'agent-onboarding::send-sla-ra-adobe',
    title: 'Send Agent SLA & RA via Adobe',
    type: 'Email',
    message: 'Send the Agent SLA (Service Level Agreement) and RA (Referral Agreement) documents via Adobe.',
    category: 'ops',
    dueOffset: { days: 0 },
  },
  {
    ruleId: 'agent-onboarding::send-referral-io-invite',
    title: 'Send Referral.io Invite email',
    type: 'Task',
    message: 'Send the Referral.io platform invitation email to the new agent.',
    category: 'ops',
    dueOffset: { days: 0 },
  },
  {
    ruleId: 'agent-onboarding::add-to-49-agents',
    title: 'Add agent to 49 agents',
    type: 'Task',
    message: 'Add the new agent to the 49 agents list/system.',
    category: 'ops',
    dueOffset: { days: 0 },
  },
  {
    ruleId: 'agent-onboarding::update-agent-worksheet',
    title: 'Update agent worksheet',
    type: 'Task',
    message: 'Update the agent worksheet with the new agent information.',
    category: 'ops',
    dueOffset: { days: 0 },
  },
  {
    ruleId: 'agent-onboarding::save-contract-package-gdrive',
    title: 'Save Agent contract package to Gdrive',
    type: 'Task',
    message: 'Save the agent contract package to Google Drive.',
    category: 'ops',
    dueOffset: { days: 0 },
  },
];

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get all task rules for a given referral status and conditions.
 */
export function getTaskRulesForStatus(
  status: string,
  options: {
    ahaBucket?: string | null;
    timeline?: ReferralTimeline | null;
    hasAhaOosAgentAttached?: boolean;
  } = {}
): TaskRuleDefinition[] {
  const { ahaBucket, timeline, hasAhaOosAgentAttached } = options;
  const isOOS = isOOSReferral(ahaBucket, hasAhaOosAgentAttached);
  const shortTimeline = isShortTimeline(timeline);

  let rules: TaskRuleDefinition[] = [];

  switch (status) {
    case 'Paired':
      rules = PAIRED_TASKS;
      break;
    case 'In Communication':
      // Choose either short (week) or long (monthly) cadence based on timeline
      if (shortTimeline) {
        rules = IN_COMMUNICATION_SHORT_TASKS;
      } else {
        rules = IN_COMMUNICATION_LONG_TASKS;
      }
      break;
    case 'Under Contract':
      rules = UNDER_CONTRACT_TASKS;
      break;
    default:
      rules = [];
  }

  // Filter by OOS requirement
  return rules.filter((rule) => {
    if (rule.oosOnly && !isOOS) {
      return false;
    }
    return true;
  });
}

/**
 * Calculate due date from a base date and offset.
 */
export function calculateDueDate(
  baseDate: Date,
  offset: { days?: number; months?: number }
): Date {
  const dueDate = new Date(baseDate);

  if (offset.days) {
    dueDate.setDate(dueDate.getDate() + offset.days);
  }

  if (offset.months) {
    dueDate.setMonth(dueDate.getMonth() + offset.months);
  }

  return dueDate;
}
