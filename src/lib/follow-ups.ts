export type FollowUpAudience = 'Agent' | 'MC' | 'Referral';
export type FollowUpChannel = 'Phone' | 'Email' | 'Text' | 'Internal';
export type FollowUpUrgency = 'Low' | 'Medium' | 'High';

export interface FollowUpTask {
  audience: FollowUpAudience;
  title: string;
  summary: string;
  suggestedChannel: FollowUpChannel;
  urgency: FollowUpUrgency;
}

export function getFollowUpTaskId(task: FollowUpTask) {
  return `${task.audience}|${task.title}|${task.summary}|${task.suggestedChannel}|${task.urgency}`;
}
