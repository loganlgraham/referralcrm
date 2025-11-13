'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { RecommendationPriority } from '@/utils/sla-insights';
import type { FollowUpTask } from '@/components/referrals/use-follow-up-tasks';

export interface CalendarTaskInput {
  taskId: string;
  title: string;
  message: string;
  dueAt?: string | null;
  referralName?: string | null;
  priority: RecommendationPriority | FollowUpTask['priority'];
  category: FollowUpTask['category'];
}

type SubmissionMode = 'single' | 'bulk';

interface CalendarSubmissionResult {
  submitTasks: (tasks: CalendarTaskInput[], mode: SubmissionMode) => Promise<void>;
  addingTaskId: string | null;
  bulkAdding: boolean;
}

export function useCalendarTaskSubmission(): CalendarSubmissionResult {
  const [addingTaskId, setAddingTaskId] = useState<string | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);

  const submitTasks = useCallback(async (tasks: CalendarTaskInput[], mode: SubmissionMode) => {
    if (!Array.isArray(tasks) || tasks.length === 0) {
      toast.info('No tasks available to add to Google Calendar.');
      return;
    }

    if (mode === 'single') {
      setAddingTaskId(tasks[0]?.taskId ?? null);
    } else {
      setBulkAdding(true);
    }

    try {
      const response = await fetch('/api/integrations/google/calendar/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tasks: tasks.map((task) => ({
            taskId: task.taskId,
            title: task.title,
            message: task.message,
            dueAt: task.dueAt ?? null,
            referralName: task.referralName ?? null,
            priority: task.priority,
            category: task.category,
          })),
        }),
      });

      if (response.ok) {
        const payload = (await response.json().catch(() => ({ created: tasks.length }))) as { created?: number };
        const createdCount = typeof payload.created === 'number' ? payload.created : tasks.length;
        if (mode === 'single') {
          toast.success('Task added to Google Calendar.');
        } else if (createdCount > 0) {
          toast.success(`${createdCount} task${createdCount === 1 ? '' : 's'} added to Google Calendar.`);
        } else {
          toast.info('No tasks were added to Google Calendar.');
        }
        return;
      }

      const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
      const message = errorPayload?.error;

      if (response.status === 412) {
        toast.error(
          message ??
            'Connect your Google account with calendar permissions to add tasks to Google Calendar.'
        );
        return;
      }

      if (response.status === 503) {
        toast.error(message ?? 'Google Calendar integration is not configured.');
        return;
      }

      toast.error(message ?? 'Unable to add task to Google Calendar.');
    } catch (error) {
      console.error('Failed to add follow-up tasks to Google Calendar', error);
      toast.error('Unable to add task to Google Calendar. Please try again later.');
    } finally {
      if (mode === 'single') {
        setAddingTaskId(null);
      } else {
        setBulkAdding(false);
      }
    }
  }, []);

  return { submitTasks, addingTaskId, bulkAdding };
}
