'use client';

import { useMemo } from 'react';

import { useFollowUpTaskContext, type ManualTask } from '@/components/referrals/follow-up-task-provider';
import type { RecommendationPriority } from '@/utils/sla-insights';

export interface AgentOnboardingTask {
  taskId: string;
  agentId: string;
  agentName?: string;
  title: string;
  message: string;
  priority: RecommendationPriority;
  category: 'ops';
  dueAt?: string | null;
  completed: boolean;
  toggle: () => void;
  isManual?: boolean;
  remove?: () => void;
}

export const DEFAULT_ONBOARDING_TASKS: Array<{
  id: string;
  title: string;
  message: string;
  priority: RecommendationPriority;
}> = [
  {
    id: 'send-sla-ra-adobe',
    title: 'Send Agent SLA & RA via Adobe',
    message: 'Send the Agent SLA (Service Level Agreement) and RA (Referral Agreement) documents via Adobe.',
    priority: 'high',
  },
  {
    id: 'send-referral-io-invite',
    title: 'Send Referral.io Invite email',
    message: 'Send the Referral.io platform invitation email to the new agent.',
    priority: 'high',
  },
  {
    id: 'add-to-49-agents',
    title: 'Add agent to 49 agents',
    message: 'Add the new agent to the 49 agents list/system.',
    priority: 'high',
  },
  {
    id: 'update-agent-worksheet',
    title: 'Update agent worksheet',
    message: 'Update the agent worksheet with the new agent information.',
    priority: 'high',
  },
  {
    id: 'save-contract-package-gdrive',
    title: 'Save Agent contract package to Gdrive',
    message: 'Save the agent contract package to Google Drive.',
    priority: 'high',
  },
];

export function generateAgentOnboardingTasks(agentId: string): ManualTask[] {
  return DEFAULT_ONBOARDING_TASKS.map((task) => ({
    id: task.id,
    title: task.title,
    message: task.message,
    dueAt: null,
    priority: task.priority,
    category: 'ops' as const,
    createdAt: new Date().toISOString(),
  }));
}

export function buildAgentOnboardingTasks(
  agentId: string,
  {
    completions,
    agentTasks,
    toggleTask,
    removeAgentTask,
    agentName,
  }: {
    completions: Record<string, { completed: boolean; completedAt?: string | null }>;
    agentTasks: Record<string, ManualTask[]>;
    toggleTask: (taskId: string, completed: boolean) => void;
    removeAgentTask: (agentId: string, taskId: string) => void;
    agentName?: string;
  }
): AgentOnboardingTask[] {
  const tasks = agentTasks[agentId] ?? [];

  return tasks.map<AgentOnboardingTask>((task) => {
    const taskId = `agent-${agentId}::onboarding::${task.id}`;
    const completion = completions[taskId]?.completed ?? false;
    const handleToggle = () => {
      toggleTask(taskId, !completion);
    };
    const handleRemove = () => {
      removeAgentTask(agentId, task.id);
    };

    return {
      taskId,
      agentId,
      agentName,
      title: task.title,
      message: task.message,
      priority: task.priority,
      category: task.category,
      dueAt: task.dueAt ?? null,
      completed: completion,
      toggle: handleToggle,
      isManual: false,
      remove: handleRemove,
    };
  });
}

export function useAgentOnboardingTasks(agentId: string, agentName?: string) {
  const { completions, agentTasks, toggleTask, removeAgentTask } = useFollowUpTaskContext();

  return useMemo(
    () =>
      buildAgentOnboardingTasks(agentId, {
        completions,
        agentTasks,
        toggleTask,
        removeAgentTask,
        agentName,
      }),
    [agentId, agentName, completions, agentTasks, toggleTask, removeAgentTask]
  );
}
