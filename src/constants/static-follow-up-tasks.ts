import type { ReferralTimeline } from './referrals';

export type TaskType = 'Task' | 'Call' | 'Text' | 'Email' | 'Auto-Email';
export type TaskCategory = 'ops' | 'communication' | 'pipeline' | 'finance';

export interface StaticTaskDefinition {
  id: string;
  title: string;
  type: TaskType;
  dueOffset: { days?: number; months?: number };
  messageTemplate: string;
  category: TaskCategory;
  conditions?: {
    timeline?: ReferralTimeline[];
    minStatusAgeDays?: number;
  };
}

export const STATIC_FOLLOW_UP_TASKS: Record<string, StaticTaskDefinition[]> = {
  'New Lead': [
    {
      id: 'add-agent-homebot',
      title: 'Add Real Estate Agent in Homebot',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Add the real estate agent to Homebot for this new lead.',
      category: 'ops',
    },
    {
      id: 'customer-care-intro',
      title: 'Customer Care: Initial Introduction',
      type: 'Call',
      dueOffset: { days: 3 },
      messageTemplate: 'Make initial introduction call to the customer.',
      category: 'communication',
    },
  ],
  'Paired': [
    {
      id: 'assign-agent-status',
      title: 'Assign Agent - Change Status to Paired',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Ensure agent is assigned and status is set to Paired.',
      category: 'ops',
    },
    {
      id: 'attach-agent-homebot',
      title: 'Attach agent to client in Homebot',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Attach the assigned agent to the client in Homebot.',
      category: 'ops',
    },
    {
      id: 'check-agent-connected',
      title: 'Check in - Agent connected with Buyer?',
      type: 'Call',
      dueOffset: { days: 1 },
      messageTemplate: 'Check in to confirm the agent has connected with the buyer.',
      category: 'communication',
    },
  ],
  'In Communication': [
    {
      id: 'check-in-week-1',
      title: 'Check in - Week 1',
      type: 'Call',
      dueOffset: { days: 4 },
      messageTemplate: 'Week 1 check-in with the client.',
      category: 'communication',
    },
    {
      id: 'check-in-week-2',
      title: 'Check in - Week 2',
      type: 'Call',
      dueOffset: { days: 10 },
      messageTemplate: 'Week 2 check-in with the client.',
      category: 'communication',
    },
    {
      id: 'check-in-week-4',
      title: 'Check in - Week 4 (1 month)',
      type: 'Call',
      dueOffset: { days: 21 },
      messageTemplate: 'One month check-in with the client.',
      category: 'communication',
    },
    {
      id: 'check-in-week-8',
      title: 'Check in - Week 8 (2 Months)',
      type: 'Email',
      dueOffset: { months: 2 },
      messageTemplate: 'Two month check-in with the client.',
      category: 'communication',
    },
    // Timeline-specific tasks for 6-12 months or 12+ months
    {
      id: 'check-in-30-day',
      title: 'Check in - 30 day',
      type: 'Call',
      dueOffset: { months: 1 },
      messageTemplate: '30 day check-in with the client.',
      category: 'communication',
      conditions: {
        timeline: ['6-12_months', '12+_months'],
      },
    },
    {
      id: 'check-in-60-day',
      title: 'Check in - 60 day',
      type: 'Call',
      dueOffset: { months: 2 },
      messageTemplate: '60 day check-in with the client.',
      category: 'communication',
      conditions: {
        timeline: ['6-12_months', '12+_months'],
      },
    },
    {
      id: 'check-in-90-day',
      title: 'Check in - 90 day',
      type: 'Text',
      dueOffset: { months: 3 },
      messageTemplate: '90 day check-in with the client.',
      category: 'communication',
      conditions: {
        timeline: ['6-12_months', '12+_months'],
      },
    },
  ],
  'Active Lead': [
    {
      id: 'check-in-week-1-active',
      title: 'Check in - Week 1',
      type: 'Call',
      dueOffset: { days: 4 },
      messageTemplate: 'Week 1 check-in with the active lead.',
      category: 'communication',
    },
    {
      id: 'check-in-week-2-active',
      title: 'Check in - Week 2',
      type: 'Call',
      dueOffset: { days: 10 },
      messageTemplate: 'Week 2 check-in with the active lead.',
      category: 'communication',
    },
    {
      id: 'check-in-week-4-active',
      title: 'Check in - Week 4 (1 month)',
      type: 'Call',
      dueOffset: { days: 21 },
      messageTemplate: 'One month check-in with the active lead.',
      category: 'communication',
    },
    {
      id: 'check-in-week-8-active',
      title: 'Check in - Week 8 (2 Months)',
      type: 'Email',
      dueOffset: { months: 2 },
      messageTemplate: 'Two month check-in with the active lead.',
      category: 'communication',
    },
  ],
  'Under Contract': [
    {
      id: 'update-realtor-audit',
      title: 'Update Realtor Audit Spreadsheet',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Update the Realtor Audit Spreadsheet with contract details.',
      category: 'ops',
    },
    {
      id: 'uc-congratulations',
      title: 'UC Congratulations - Agent Call',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Call the agent to congratulate them on getting under contract.',
      category: 'communication',
    },
    {
      id: 'save-contract-gdrive',
      title: 'Save Contract in Gdrive folder',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Save the contract documents to the Google Drive folder.',
      category: 'ops',
    },
    {
      id: 'check-in-uc-midway',
      title: 'Check in UC - Midway',
      type: 'Email',
      dueOffset: { days: 14 },
      messageTemplate: 'Midway check-in for the under contract deal.',
      category: 'communication',
    },
    {
      id: 'send-w9-instructions',
      title: 'Send W-9 and Check Instructions',
      type: 'Auto-Email',
      dueOffset: { days: 23 },
      messageTemplate: 'Send W-9 form and check payment instructions to the agent.',
      category: 'finance',
    },
    {
      id: 'confirm-closing-on-track',
      title: 'Call and Confirm Closing is still on',
      type: 'Call',
      dueOffset: { days: 29 },
      messageTemplate: 'Call to confirm the closing date is still on track.',
      category: 'communication',
    },
    {
      id: 'change-deal-closed',
      title: 'Change Deal to Closed/ Double check close date is correct',
      type: 'Task',
      dueOffset: { days: 31 },
      messageTemplate: 'Change deal status to Closed and verify the closing date is correct.',
      category: 'ops',
    },
  ],
  'Closed': [
    {
      id: 'update-49-agents-map',
      title: 'Update 49 Agents map - yellow',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Update the 49 Agents map to mark this deal as closed (yellow).',
      category: 'ops',
    },
    {
      id: 'buyer-concierge-feedback',
      title: 'Buyer Concierge Feedback email',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Send buyer concierge feedback email.',
      category: 'communication',
    },
    {
      id: 'post-closing-card',
      title: 'Post Closing card - Agent/Buyer',
      type: 'Task',
      dueOffset: { days: 0 },
      messageTemplate: 'Send post-closing card to both the agent and buyer.',
      category: 'communication',
    },
  ],
};
