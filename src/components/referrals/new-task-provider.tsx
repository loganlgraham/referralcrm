'use client';

/**
 * New Task Provider - Simplified provider for the rebuilt task system.
 *
 * Key differences from the old provider:
 * - Server is the SINGLE source of truth (no localStorage)
 * - Tasks are persisted documents (not generated on read)
 * - Simple fetch/update pattern with optimistic updates
 * - Admin-only (no RBAC complexity)
 */

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from 'react';

import type { FollowUpTaskResponse } from '@/models/follow-up-task';

// Re-export types for convenience
export type { FollowUpTaskResponse } from '@/models/follow-up-task';

export interface TaskInput {
  referralId?: string;
  agentId?: string;
  scope: 'referral' | 'agent';
  type: 'Task' | 'Call' | 'Email' | 'Text' | 'Auto-Email';
  title: string;
  message: string;
  category: 'ops' | 'communication' | 'pipeline' | 'finance';
  dueAt: string; // ISO date string
}

interface TaskProviderContextValue {
  // Task state
  tasks: FollowUpTaskResponse[];
  isLoading: boolean;
  error: string | null;

  // Actions
  loadTasks: (options?: {
    referralId?: string;
    referralIds?: string[];
    agentId?: string;
    scope?: 'referral' | 'agent';
    status?: 'open' | 'completed';
    includeCompleted?: boolean;
  }) => Promise<void>;

  toggleTask: (taskId: string, completed: boolean) => Promise<void>;
  createTask: (input: TaskInput) => Promise<FollowUpTaskResponse | null>;
  deleteTask: (taskId: string) => Promise<boolean>;
  syncReferralTasks: (referralId: string) => Promise<void>;
  syncAgentTasks: (agentId: string) => Promise<void>;

  // Helpers
  getTasksForReferral: (referralId: string) => FollowUpTaskResponse[];
  getTasksForAgent: (agentId: string) => FollowUpTaskResponse[];
  getOpenTasks: () => FollowUpTaskResponse[];
  getCompletedTasks: () => FollowUpTaskResponse[];
}

const TaskProviderContext = createContext<TaskProviderContextValue | null>(null);

const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
};

export function NewTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<FollowUpTaskResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  /**
   * Load tasks from the server with optional filters.
   */
  const loadTasks = useCallback(
    async (options?: {
      referralId?: string;
      referralIds?: string[];
      agentId?: string;
      scope?: 'referral' | 'agent';
      status?: 'open' | 'completed';
      includeCompleted?: boolean;
    }) => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();

        if (options?.referralId) {
          params.set('referralId', options.referralId);
        }
        if (options?.referralIds?.length) {
          params.set('referralIds', options.referralIds.join(','));
        }
        if (options?.agentId) {
          params.set('agentId', options.agentId);
        }
        if (options?.scope) {
          params.set('scope', options.scope);
        }
        if (options?.status) {
          params.set('status', options.status);
        }
        if (options?.includeCompleted) {
          params.set('includeCompleted', 'true');
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
        const loadedTasks = data.tasks as FollowUpTaskResponse[];

        startTransition(() => {
          setTasks((prevTasks) => {
            // Merge new tasks with existing ones, replacing duplicates
            const taskMap = new Map<string, FollowUpTaskResponse>();

            // Keep existing tasks that aren't being replaced
            for (const task of prevTasks) {
              // Only keep tasks that don't match the current filter criteria
              const shouldKeep =
                (!options?.referralId || task.referralId !== options.referralId) &&
                (!options?.referralIds?.length || !options.referralIds.includes(task.referralId ?? '')) &&
                (!options?.agentId || task.agentId !== options.agentId);

              if (shouldKeep) {
                taskMap.set(task._id, task);
              }
            }

            // Add new tasks
            for (const task of loadedTasks) {
              taskMap.set(task._id, task);
            }

            return Array.from(taskMap.values());
          });
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        console.error('[Task Provider] Failed to load tasks:', err);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  /**
   * Toggle task completion status.
   * Uses optimistic update for instant UI feedback.
   */
  const toggleTask = useCallback(async (taskId: string, completed: boolean) => {
    // Capture the original task state before optimistic update for proper reversion
    const originalTask = tasks.find((t) => t._id === taskId);
    const completedAt = completed ? new Date().toISOString() : null;

    // Optimistic update
    startTransition(() => {
      setTasks((prevTasks) =>
        prevTasks.map((task) =>
          task._id === taskId
            ? { ...task, status: completed ? 'completed' : 'open', completedAt }
            : task
        )
      );
    });

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

      // Update with server response (may have additional fields like completedByUserId)
      startTransition(() => {
        setTasks((prevTasks) =>
          prevTasks.map((task) => (task._id === taskId ? updatedTask : task))
        );
      });
    } catch (err) {
      // Revert optimistic update on error, restoring the original task state
      if (originalTask) {
        startTransition(() => {
          setTasks((prevTasks) =>
            prevTasks.map((task) =>
              task._id === taskId
                ? { ...task, status: originalTask.status, completedAt: originalTask.completedAt }
                : task
            )
          );
        });
      }
      console.error('[Task Provider] Failed to toggle task:', err);
      throw err;
    }
  }, [tasks]);

  /**
   * Create a new manual task.
   */
  const createTask = useCallback(async (input: TaskInput): Promise<FollowUpTaskResponse | null> => {
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...NO_CACHE_HEADERS,
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error('Failed to create task');
      }

      const data = await response.json();
      const newTask = data.task as FollowUpTaskResponse;

      // Add to local state
      startTransition(() => {
        setTasks((prevTasks) => [...prevTasks, newTask]);
      });

      return newTask;
    } catch (err) {
      console.error('[Task Provider] Failed to create task:', err);
      return null;
    }
  }, []);

  /**
   * Delete a manual task.
   */
  const deleteTask = useCallback(async (taskId: string): Promise<boolean> => {
    // Find the task to check if it's manual
    const taskToDelete = tasks.find((t) => t._id === taskId);
    if (!taskToDelete) {
      return false;
    }

    // Optimistic update
    startTransition(() => {
      setTasks((prevTasks) => prevTasks.filter((task) => task._id !== taskId));
    });

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'DELETE',
        headers: NO_CACHE_HEADERS,
      });

      if (!response.ok) {
        throw new Error('Failed to delete task');
      }

      return true;
    } catch (err) {
      // Revert optimistic update on error
      startTransition(() => {
        setTasks((prevTasks) => [...prevTasks, taskToDelete]);
      });
      console.error('[Task Provider] Failed to delete task:', err);
      return false;
    }
  }, [tasks]);

  /**
   * Trigger task sync for a referral (creates missing static tasks).
   */
  const syncReferralTasks = useCallback(async (referralId: string) => {
    try {
      const response = await fetch('/api/tasks/sync/referral', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...NO_CACHE_HEADERS,
        },
        body: JSON.stringify({ referralId }),
      });

      if (!response.ok) {
        throw new Error('Failed to sync referral tasks');
      }

      // Reload tasks for this referral
      await loadTasks({ referralId, includeCompleted: true });
    } catch (err) {
      console.error('[Task Provider] Failed to sync referral tasks:', err);
    }
  }, [loadTasks]);

  /**
   * Trigger task sync for an agent (creates missing onboarding tasks).
   */
  const syncAgentTasks = useCallback(async (agentId: string) => {
    try {
      const response = await fetch('/api/tasks/sync/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...NO_CACHE_HEADERS,
        },
        body: JSON.stringify({ agentId }),
      });

      if (!response.ok) {
        throw new Error('Failed to sync agent tasks');
      }

      // Reload tasks for this agent
      await loadTasks({ agentId, scope: 'agent', includeCompleted: true });
    } catch (err) {
      console.error('[Task Provider] Failed to sync agent tasks:', err);
    }
  }, [loadTasks]);

  // Helper functions
  const getTasksForReferral = useCallback(
    (referralId: string) => tasks.filter((task) => task.referralId === referralId),
    [tasks]
  );

  const getTasksForAgent = useCallback(
    (agentId: string) => tasks.filter((task) => task.agentId === agentId),
    [tasks]
  );

  const getOpenTasks = useCallback(
    () => tasks.filter((task) => task.status === 'open'),
    [tasks]
  );

  const getCompletedTasks = useCallback(
    () => tasks.filter((task) => task.status === 'completed'),
    [tasks]
  );

  const value = useMemo<TaskProviderContextValue>(
    () => ({
      tasks,
      isLoading,
      error,
      loadTasks,
      toggleTask,
      createTask,
      deleteTask,
      syncReferralTasks,
      syncAgentTasks,
      getTasksForReferral,
      getTasksForAgent,
      getOpenTasks,
      getCompletedTasks,
    }),
    [
      tasks,
      isLoading,
      error,
      loadTasks,
      toggleTask,
      createTask,
      deleteTask,
      syncReferralTasks,
      syncAgentTasks,
      getTasksForReferral,
      getTasksForAgent,
      getOpenTasks,
      getCompletedTasks,
    ]
  );

  return (
    <TaskProviderContext.Provider value={value}>
      {children}
    </TaskProviderContext.Provider>
  );
}

export function useTaskProvider(): TaskProviderContextValue {
  const context = useContext(TaskProviderContext);
  if (!context) {
    throw new Error('useTaskProvider must be used within a NewTaskProvider');
  }
  return context;
}

/**
 * Hook to load and manage tasks for a specific referral.
 */
export function useReferralTasks(referralId: string, options?: { includeCompleted?: boolean }) {
  const { tasks, isLoading, toggleTask, createTask, deleteTask, loadTasks, syncReferralTasks } =
    useTaskProvider();

  const referralTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.referralId === referralId)
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [tasks, referralId]
  );

  const openTasks = useMemo(
    () => referralTasks.filter((task) => task.status === 'open'),
    [referralTasks]
  );

  const completedTasks = useMemo(
    () => referralTasks.filter((task) => task.status === 'completed'),
    [referralTasks]
  );

  const reload = useCallback(() => {
    return loadTasks({ referralId, includeCompleted: options?.includeCompleted ?? true });
  }, [loadTasks, referralId, options?.includeCompleted]);

  const sync = useCallback(() => {
    return syncReferralTasks(referralId);
  }, [syncReferralTasks, referralId]);

  return {
    tasks: referralTasks,
    openTasks,
    completedTasks,
    isLoading,
    toggleTask,
    createTask,
    deleteTask,
    reload,
    sync,
  };
}

/**
 * Hook to load and manage tasks for a specific agent.
 */
export function useAgentTasks(agentId: string, options?: { includeCompleted?: boolean }) {
  const { tasks, isLoading, toggleTask, loadTasks, syncAgentTasks } = useTaskProvider();

  const agentTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.agentId === agentId)
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [tasks, agentId]
  );

  const openTasks = useMemo(
    () => agentTasks.filter((task) => task.status === 'open'),
    [agentTasks]
  );

  const completedTasks = useMemo(
    () => agentTasks.filter((task) => task.status === 'completed'),
    [agentTasks]
  );

  const reload = useCallback(() => {
    return loadTasks({ agentId, scope: 'agent', includeCompleted: options?.includeCompleted ?? true });
  }, [loadTasks, agentId, options?.includeCompleted]);

  const sync = useCallback(() => {
    return syncAgentTasks(agentId);
  }, [syncAgentTasks, agentId]);

  return {
    tasks: agentTasks,
    openTasks,
    completedTasks,
    isLoading,
    toggleTask,
    reload,
    sync,
  };
}
