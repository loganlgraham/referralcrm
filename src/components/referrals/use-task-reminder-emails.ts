'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { RecommendationPriority } from '@/utils/sla-insights';
import type { FollowUpTask } from '@/components/referrals/use-follow-up-tasks';
import { useFollowUpTaskContext, type ReminderFrequency } from '@/components/referrals/follow-up-task-provider';

export interface ReminderTaskInput {
  taskId: string;
  referralId: string;
  title: string;
  message: string;
  dueAt?: string | null;
  referralName?: string | null;
  priority: RecommendationPriority | FollowUpTask['priority'];
  category: FollowUpTask['category'];
}

export type ReminderCadence = ReminderFrequency;

type SubmissionMode = 'single' | 'bulk';

interface ReminderSubmissionResult {
  sendReminders: (tasks: ReminderTaskInput[], mode: SubmissionMode) => Promise<void>;
  sendingTaskId: string | null;
  bulkSending: boolean;
  reminderEnabled: boolean;
  reminderFrequency: ReminderCadence;
}

export function useTaskReminderEmails(referralId?: string): ReminderSubmissionResult {
  const { getReminderSettings } = useFollowUpTaskContext();
  const [sendingTaskId, setSendingTaskId] = useState<string | null>(null);
  const [bulkSending, setBulkSending] = useState(false);
  const reminderSettings = getReminderSettings(referralId);

  const sendReminders = useCallback(
    async (tasks: ReminderTaskInput[], mode: SubmissionMode) => {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        toast.info('No tasks available for reminder emails.');
        return;
      }

      if (!reminderSettings.enabled) {
        toast.error('Turn on task reminder emails to send updates.');
        return;
      }

      if (mode === 'single') {
        setSendingTaskId(tasks[0]?.taskId ?? null);
      } else {
        setBulkSending(true);
      }

      try {
        const response = await fetch('/api/follow-up/reminders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frequency: reminderSettings.frequency,
            tasks: tasks.map((task) => ({
              taskId: task.taskId,
              referralId: task.referralId,
              title: task.title,
              message: task.message,
              dueAt: task.dueAt ?? null,
              referralName: task.referralName ?? null,
              priority: task.priority,
              category: task.category,
            })),
          }),
        });

        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.ok) {
          toast.success(`Reminder email queued for ${reminderSettings.frequency === 'daily' ? 'daily' : 'weekly'} delivery.`);
          return;
        }

        if (response.status === 503) {
          toast.error(payload?.error ?? 'Reminder emails are not configured.');
          return;
        }

        toast.error(payload?.error ?? 'Unable to send reminder email. Please try again later.');
      } catch (error) {
        console.error('Failed to send follow-up task reminder email', error);
        toast.error('Unable to send reminder email. Please try again later.');
      } finally {
        if (mode === 'single') {
          setSendingTaskId(null);
        } else {
          setBulkSending(false);
        }
      }
    },
    [reminderSettings]
  );

  return {
    sendReminders,
    sendingTaskId,
    bulkSending,
    reminderEnabled: reminderSettings.enabled,
    reminderFrequency: reminderSettings.frequency,
  };
}
