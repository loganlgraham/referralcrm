'use client';

/**
 * Hook for using persisted tasks from the new task system.
 *
 * This hook bridges the new persisted task model with the existing UI components
 * by returning tasks in a compatible format.
 *
 * Key differences from the old system:
 * - Tasks are fetched from the database (not generated on read)
 * - Completion is a field on the task document (not separate state)
 * - Server is the single source of truth
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { FollowUpTaskResponse } from '@/models/follow-up-task';
import type { SlaRecommendation } from '@/utils/sla-insights';

// Interface compatible with existing UI components
export interface PersistedTask extends SlaRecommendation {
  taskId: string;
  _id: string; // MongoDB ObjectId as string
  referralId: string;
  agentId?: string | null;
  referralName?: string;
  completed: boolean;
  completedAt?: string | null;
  toggle: () => void;
  isManual: boolean;
  source: 'static' | 'manual';
  ruleId?: string | null;
  statusWhenCreated?: string | null;
  remove?: () => void;
  // Task type from the new model
  taskType: 'Task' | 'Call' | 'Email' | 'Text' | 'Auto-Email';
}

interface UsePersistedTasksOptions {
  referralId?: string;
  referralIds?: string[];
  agentId?: string;
  scope?: 'referral' | 'agent';
  includeCompleted?: boolean;
  referralName?: string;
}

interface UsePersistedTasksReturn {
  tasks: PersistedTask[];
  openTasks: PersistedTask[];
  completedTasks: PersistedTask[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  sync: () => Promise<void>;
}

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

/**
 * Convert API response to UI-compatible task format.
 */
function toPersistedTask(
  task: FollowUpTaskResponse,
  toggleFn: (taskId: string, completed: boolean) => Promise<void>,
  deleteFn?: (taskId: string) => Promise<void>,
  referralName?: string
): PersistedTask {
  const completed = task.status === 'completed';

  return {
    // SlaRecommendation fields
    id: task.ruleId ?? task._id,
    title: task.title,
    message: task.message,
    priority: mapPriority(task.dueAt, task.status),
    category: task.category,
    dueAt: task.dueAt,
    supportingMetric: undefined,

    // Extended fields
    taskId: task._id,
    _id: task._id,
    referralId: task.referralId ?? '',
    agentId: task.agentId,
    referralName,
    completed,
    completedAt: task.completedAt,
    toggle: () => toggleFn(task._id, !completed),
    isManual: task.source === 'manual',
    source: task.source,
    ruleId: task.ruleId,
    statusWhenCreated: task.statusWhenCreated,
    remove: task.source === 'manual' && deleteFn ? () => deleteFn(task._id) : undefined,
    taskType: task.type,
  };
}

/**
 * Map due date and status to priority for display.
 */
function mapPriority(
  dueAt: string,
  status: 'open' | 'completed'
): 'urgent' | 'high' | 'medium' | 'low' {
  if (status === 'completed') {
    return 'low';
  }

  const now = new Date();
  const due = new Date(dueAt);
  const diffDays = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'urgent'; // Overdue
  }
  if (diffDays === 0) {
    return 'high'; // Due today
  }
  if (diffDays <= 3) {
    return 'medium'; // Due within 3 days
  }
  return 'low'; // Future
}

/**
 * Hook to load and manage persisted tasks.
 */
export function usePersistedTasks(options: UsePersistedTasksOptions): UsePersistedTasksReturn {
  const [tasks, setTasks] = useState<FollowUpTaskResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { referralId, referralIds, agentId, scope, includeCompleted = true, referralName } = options;

  // Fetch tasks from API
  const loadTasks = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      if (referralId) {
        params.set('referralId', referralId);
      }
      if (referralIds?.length) {
        params.set('referralIds', referralIds.join(','));
      }
      if (agentId) {
        params.set('agentId', agentId);
      }
      if (scope) {
        params.set('scope', scope);
      }
      if (!includeCompleted) {
        params.set('status', 'open');
      }

      // Add cache buster
      params.set('_t', Date.now().toString());

      const response = await fetch(`/api/tasks?${params.toString()}`, {
        headers: NO_CACHE_HEADERS,
      });

      if (!response.ok) {
        throw new Error('Failed to load tasks');
      }

      const data = await response.json();
      setTasks(data.tasks as FollowUpTaskResponse[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('[usePersistedTasks] Failed to load tasks:', err);
    } finally {
      setIsLoading(false);
    }
  }, [referralId, referralIds, agentId, scope, includeCompleted]);

  // Load tasks on mount and when dependencies change
  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Toggle task completion
  const toggleTask = useCallback(async (taskId: string, completed: boolean) => {
    const completedAt = completed ? new Date().toISOString() : null;

    // Optimistic update
    setTasks((prev) =>
      prev.map((task) =>
        task._id === taskId
          ? { ...task, status: completed ? 'completed' : 'open', completedAt } as FollowUpTaskResponse
          : task
      )
    );

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...NO_CACHE_HEADERS,
        },
        body: JSON.stringify({
          status: completed ? 'completed' : 'open',
          completedAt,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to toggle task');
      }

      const data = await response.json();
      const updatedTask = data.task as FollowUpTaskResponse;

      // Update with server response
      setTasks((prev) =>
        prev.map((task) => (task._id === taskId ? updatedTask : task))
      );
    } catch (err) {
      // Revert optimistic update on error
      setTasks((prev) =>
        prev.map((task) =>
          task._id === taskId
            ? { ...task, status: completed ? 'open' : 'completed', completedAt: null } as FollowUpTaskResponse
            : task
        )
      );
      console.error('[usePersistedTasks] Failed to toggle task:', err);
      throw err;
    }
  }, []);

  // Delete a manual task
  const deleteTask = useCallback(async (taskId: string) => {
    const taskToDelete = tasks.find((t) => t._id === taskId);
    if (!taskToDelete || taskToDelete.source !== 'manual') {
      return;
    }

    // Optimistic update
    setTasks((prev) => prev.filter((task) => task._id !== taskId));

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: NO_CACHE_HEADERS,
      });

      if (!response.ok) {
        throw new Error('Failed to delete task');
      }
    } catch (err) {
      // Revert optimistic update on error
      setTasks((prev) => [...prev, taskToDelete]);
      console.error('[usePersistedTasks] Failed to delete task:', err);
      throw err;
    }
  }, [tasks]);

  // Sync tasks (trigger server-side task generation)
  const sync = useCallback(async () => {
    try {
      if (referralId) {
        await fetch('/api/tasks/sync/referral', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...NO_CACHE_HEADERS,
          },
          body: JSON.stringify({ referralId }),
        });
      }

      if (agentId) {
        await fetch('/api/tasks/sync/agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...NO_CACHE_HEADERS,
          },
          body: JSON.stringify({ agentId }),
        });
      }

      // Reload tasks after sync
      await loadTasks();
    } catch (err) {
      console.error('[usePersistedTasks] Failed to sync tasks:', err);
    }
  }, [referralId, agentId, loadTasks]);

  // Convert to UI-compatible format
  const persistedTasks = useMemo(() => {
    return tasks
      .map((task) => toPersistedTask(task, toggleTask, deleteTask, referralName))
      .sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime());
  }, [tasks, toggleTask, deleteTask, referralName]);

  const openTasks = useMemo(
    () => persistedTasks.filter((task) => !task.completed),
    [persistedTasks]
  );

  const completedTasks = useMemo(
    () => persistedTasks.filter((task) => task.completed),
    [persistedTasks]
  );

  return {
    tasks: persistedTasks,
    openTasks,
    completedTasks,
    isLoading,
    error,
    reload: loadTasks,
    sync,
  };
}

/**
 * Hook specifically for referral tasks.
 */
export function useReferralPersistedTasks(
  referralId: string,
  options?: { includeCompleted?: boolean; referralName?: string }
) {
  return usePersistedTasks({
    referralId,
    scope: 'referral',
    includeCompleted: options?.includeCompleted ?? true,
    referralName: options?.referralName,
  });
}

/**
 * Hook specifically for agent onboarding tasks.
 */
export function useAgentPersistedTasks(
  agentId: string,
  options?: { includeCompleted?: boolean }
) {
  return usePersistedTasks({
    agentId,
    scope: 'agent',
    includeCompleted: options?.includeCompleted ?? true,
  });
}

/**
 * Hook for the Task Board - loads tasks for multiple referrals.
 */
export function useTaskBoardTasks(
  referralIds: string[],
  options?: { includeCompleted?: boolean }
) {
  return usePersistedTasks({
    referralIds,
    scope: 'referral',
    includeCompleted: options?.includeCompleted ?? false,
  });
}
