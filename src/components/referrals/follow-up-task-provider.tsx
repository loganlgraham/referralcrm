'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useTransition,
} from 'react';

import type { RecommendationPriority } from '@/utils/sla-insights';

interface TaskCompletionState {
  completed: boolean;
  completedAt?: string | null;
}

type CompletionMap = Record<string, TaskCompletionState>;

export type ManualTaskCategory = 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';

export type ReminderFrequency = 'daily' | 'weekly';

interface ReminderSettings {
  enabled: boolean;
  frequency: ReminderFrequency;
}

interface ReminderState {
  global: ReminderSettings;
  overrides: Record<string, ReminderSettings>;
}

export interface ManualTask {
  id: string;
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
  createdAt: string;
}

export interface ManualTaskInput {
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
}

export interface TaskMetadata {
  title: string;
  message: string;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
  dueAt?: string | null;
  supportingMetric?: string;
  isManual?: boolean;
  createdAt: string;
  statusWhenCreated?: string;
}

export interface StoredTaskState {
  completions: CompletionMap;
  manualTasks: Record<string, ManualTask[]>;
  agentTasks: Record<string, ManualTask[]>;
  reminders: ReminderState;
  shownTasks: Record<string, string[]>; // referralId -> taskId[]
  taskMetadata: Record<string, TaskMetadata>; // full taskId -> metadata
}

type Action =
  | { type: 'toggle'; taskId: string; completed: boolean }
  | { type: 'hydrate'; payload: StoredTaskState }
  | { type: 'add-manual'; referralId: string; task: ManualTask }
  | { type: 'remove-manual'; referralId: string; taskId: string }
  | { type: 'add-agent-tasks'; agentId: string; tasks: ManualTask[] }
  | { type: 'remove-agent-task'; agentId: string; taskId: string }
  | { type: 'set-global-reminders'; settings: ReminderSettings }
  | { type: 'set-referral-reminders'; referralId: string; settings: ReminderSettings | null }
  | { type: 'mark-tasks-shown'; referralId: string; taskIds: string[] }
  | { type: 'store-task-metadata'; tasks: Array<{ taskId: string; metadata: TaskMetadata }> };

interface FollowUpTaskContextValue {
  completions: CompletionMap;
  manualTasks: Record<string, ManualTask[]>;
  agentTasks: Record<string, ManualTask[]>;
  shownTasks: Record<string, string[]>;
  taskMetadata: Record<string, TaskMetadata>;
  toggleTask: (taskId: string, completed: boolean) => void;
  addManualTask: (referralId: string, task: ManualTaskInput) => void;
  removeManualTask: (referralId: string, taskId: string) => void;
  addAgentTasks: (agentId: string, tasks: ManualTask[]) => void;
  removeAgentTask: (agentId: string, taskId: string) => void;
  markTasksAsShown: (referralId: string, taskIds: string[]) => void;
  storeTaskMetadata: (tasks: Array<{ taskId: string; metadata: TaskMetadata }>) => void;
  reminderSettings: ReminderSettings;
  globalReminderSettings: ReminderSettings;
  reminderOverrides: Record<string, ReminderSettings>;
  getReminderSettings: (referralId?: string) => ReminderSettings;
  updateReminderSettings: (settings: ReminderSettings, referralId?: string) => void;
  clearReminderOverride: (referralId: string) => void;
  hasReminderOverride: (referralId: string) => boolean;
}

export const FOLLOW_UP_TASK_STORAGE_KEY = 'referralcrm.followUpTasks';

const FollowUpTaskContext = createContext<FollowUpTaskContextValue | null>(null);

export const defaultReminderSettings: ReminderSettings = { enabled: false, frequency: 'daily' };

export const defaultReminderState: ReminderState = {
  global: defaultReminderSettings,
  overrides: {},
};

export const createDefaultTaskState = (): StoredTaskState => ({
  completions: {},
  manualTasks: {},
  agentTasks: {},
  reminders: { global: { ...defaultReminderSettings }, overrides: {} },
  shownTasks: {},
  taskMetadata: {},
});

const reducer = (state: StoredTaskState, action: Action): StoredTaskState => {
  switch (action.type) {
    case 'hydrate':
      return { ...createDefaultTaskState(), ...action.payload };
    case 'toggle': {
      const nextCompletions: CompletionMap = { ...state.completions };
      nextCompletions[action.taskId] = {
        completed: action.completed,
        completedAt: action.completed ? new Date().toISOString() : null,
      };
      return { ...state, completions: nextCompletions };
    }
    case 'add-manual': {
      const current = state.manualTasks[action.referralId] ?? [];
      return {
        ...state,
        manualTasks: {
          ...state.manualTasks,
          [action.referralId]: [...current, action.task],
        },
      };
    }
    case 'remove-manual': {
      const current = state.manualTasks[action.referralId] ?? [];
      const manualCompletionKey = `${action.referralId}::manual::${action.taskId}`;
      const nextCompletions: CompletionMap = { ...state.completions };
      delete nextCompletions[manualCompletionKey];
      
      // Remove from shownTasks
      const currentShown = state.shownTasks[action.referralId] ?? [];
      const nextShownTasks = {
        ...state.shownTasks,
        [action.referralId]: currentShown.filter((id) => id !== action.taskId),
      };
      
      // Remove from taskMetadata
      const nextMetadata = { ...state.taskMetadata };
      delete nextMetadata[manualCompletionKey];
      
      return {
        ...state,
        manualTasks: {
          ...state.manualTasks,
          [action.referralId]: current.filter((task) => task.id !== action.taskId),
        },
        completions: nextCompletions,
        shownTasks: nextShownTasks,
        taskMetadata: nextMetadata,
      };
    }
    case 'add-agent-tasks': {
      const existing = state.agentTasks[action.agentId] ?? [];
      return {
        ...state,
        agentTasks: {
          ...state.agentTasks,
          [action.agentId]: [...existing, ...action.tasks],
        },
      };
    }
    case 'remove-agent-task': {
      const current = state.agentTasks[action.agentId] ?? [];
      const agentCompletionKey = `agent-${action.agentId}::onboarding::${action.taskId}`;
      const nextCompletions: CompletionMap = { ...state.completions };
      delete nextCompletions[agentCompletionKey];
      return {
        ...state,
        agentTasks: {
          ...state.agentTasks,
          [action.agentId]: current.filter((task) => task.id !== action.taskId),
        },
        completions: nextCompletions,
      };
    }
    case 'set-global-reminders': {
      return { ...state, reminders: { ...state.reminders, global: action.settings } };
    }
    case 'set-referral-reminders': {
      const overrides = { ...state.reminders.overrides };
      if (action.settings === null) {
        delete overrides[action.referralId];
      } else {
        overrides[action.referralId] = action.settings;
      }
      return { ...state, reminders: { ...state.reminders, overrides } };
    }
    case 'mark-tasks-shown': {
      const currentShown = state.shownTasks[action.referralId] ?? [];
      const uniqueTaskIds = Array.from(new Set([...currentShown, ...action.taskIds]));
      return {
        ...state,
        shownTasks: {
          ...state.shownTasks,
          [action.referralId]: uniqueTaskIds,
        },
      };
    }
    case 'store-task-metadata': {
      const nextMetadata = { ...state.taskMetadata };
      for (const { taskId, metadata } of action.tasks) {
        // Only store if not already present (preserve original metadata)
        if (!nextMetadata[taskId]) {
          nextMetadata[taskId] = metadata;
        }
      }
      return { ...state, taskMetadata: nextMetadata };
    }
    default:
      return state;
  }
};

export const parseFollowUpTaskState = (value: string | null): StoredTaskState => {
  if (!value) return createDefaultTaskState();
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if ('completions' in record || 'manualTasks' in record || 'agentTasks' in record || 'reminders' in record) {
        const completions =
          record.completions && typeof record.completions === 'object' ? (record.completions as CompletionMap) : {};
        const manualTasksEntries =
          record.manualTasks && typeof record.manualTasks === 'object'
            ? (record.manualTasks as Record<string, unknown>)
            : {};
        const manualTasks: Record<string, ManualTask[]> = {};
        Object.entries(manualTasksEntries).forEach(([key, value]) => {
          if (!Array.isArray(value)) {
            return;
          }
          const sanitized = value
            .map((task) => {
              if (!task || typeof task !== 'object') {
                return null;
              }
              const payload = task as Partial<ManualTask>;
              const id = typeof payload.id === 'string' ? payload.id : null;
              const title = typeof payload.title === 'string' ? payload.title : null;
              const message = typeof payload.message === 'string' ? payload.message : null;
              const category = payload.category;
              const priority = payload.priority;
              if (!id || !title || !message) {
                return null;
              }
              if (
                category !== 'assignment' &&
                category !== 'communication' &&
                category !== 'pipeline' &&
                category !== 'finance' &&
                category !== 'ops'
              ) {
                return null;
              }
              if (priority !== 'urgent' && priority !== 'high' && priority !== 'medium' && priority !== 'low') {
                return null;
              }
              return {
                id,
                title,
                message,
                dueAt: typeof payload.dueAt === 'string' ? payload.dueAt : null,
                priority,
                category,
                createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
              } as ManualTask;
            })
            .filter((task): task is ManualTask => Boolean(task));
          if (sanitized.length > 0) {
            manualTasks[key] = sanitized;
          }
        });
        const agentTasksEntries =
          record.agentTasks && typeof record.agentTasks === 'object'
            ? (record.agentTasks as Record<string, unknown>)
            : {};
        const agentTasks: Record<string, ManualTask[]> = {};
        Object.entries(agentTasksEntries).forEach(([key, value]) => {
          if (!Array.isArray(value)) {
            return;
          }
          const sanitized = value
            .map((task) => {
              if (!task || typeof task !== 'object') {
                return null;
              }
              const payload = task as Partial<ManualTask>;
              const id = typeof payload.id === 'string' ? payload.id : null;
              const title = typeof payload.title === 'string' ? payload.title : null;
              const message = typeof payload.message === 'string' ? payload.message : null;
              const category = payload.category;
              const priority = payload.priority;
              if (!id || !title || !message) {
                return null;
              }
              if (
                category !== 'assignment' &&
                category !== 'communication' &&
                category !== 'pipeline' &&
                category !== 'finance' &&
                category !== 'ops'
              ) {
                return null;
              }
              if (priority !== 'urgent' && priority !== 'high' && priority !== 'medium' && priority !== 'low') {
                return null;
              }
              return {
                id,
                title,
                message,
                dueAt: typeof payload.dueAt === 'string' ? payload.dueAt : null,
                priority,
                category,
                createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
              } as ManualTask;
            })
            .filter((task): task is ManualTask => Boolean(task));
          if (sanitized.length > 0) {
            agentTasks[key] = sanitized;
          }
        });
        const reminders = (() => {
          const parseSettings = (candidate: unknown): ReminderSettings | null => {
            if (!candidate || typeof candidate !== 'object') return null;
            const reminderRecord = candidate as Record<string, unknown>;
            const enabled = Boolean(reminderRecord.enabled);
            const frequency = reminderRecord.frequency === 'weekly' ? 'weekly' : 'daily';
            return { enabled, frequency } satisfies ReminderSettings;
          };

          if (record.reminders && typeof record.reminders === 'object') {
            const reminderRecord = record.reminders as Record<string, unknown>;
            const globalSettings = parseSettings(reminderRecord.global) ?? parseSettings(reminderRecord);
            const overrides: Record<string, ReminderSettings> = {};

            if (reminderRecord.overrides && typeof reminderRecord.overrides === 'object') {
              Object.entries(reminderRecord.overrides as Record<string, unknown>).forEach(([referralId, value]) => {
                const parsed = parseSettings(value);
                if (parsed) {
                  overrides[referralId] = parsed;
                }
              });
            }

            return {
              global: globalSettings ?? { ...defaultReminderSettings },
              overrides: { ...overrides },
            } satisfies ReminderState;
          }

          const legacySettings = parseSettings(record.reminders);
          if (legacySettings) {
            return { global: legacySettings, overrides: {} } satisfies ReminderState;
          }

          return { ...defaultReminderState, overrides: {} } satisfies ReminderState;
        })();
        
        // Parse shownTasks
        const shownTasks: Record<string, string[]> = {};
        if (record.shownTasks && typeof record.shownTasks === 'object') {
          Object.entries(record.shownTasks as Record<string, unknown>).forEach(([referralId, value]) => {
            if (Array.isArray(value)) {
              shownTasks[referralId] = value.filter((id): id is string => typeof id === 'string');
            }
          });
        }
        
        // Parse taskMetadata
        const taskMetadata: Record<string, TaskMetadata> = {};
        if (record.taskMetadata && typeof record.taskMetadata === 'object') {
          Object.entries(record.taskMetadata as Record<string, unknown>).forEach(([taskId, value]) => {
            if (value && typeof value === 'object') {
              const meta = value as Partial<TaskMetadata>;
              if (
                typeof meta.title === 'string' &&
                typeof meta.message === 'string' &&
                (meta.priority === 'urgent' || meta.priority === 'high' || meta.priority === 'medium' || meta.priority === 'low') &&
                (meta.category === 'assignment' || meta.category === 'communication' || meta.category === 'pipeline' || meta.category === 'finance' || meta.category === 'ops')
              ) {
                taskMetadata[taskId] = {
                  title: meta.title,
                  message: meta.message,
                  priority: meta.priority,
                  category: meta.category,
                  dueAt: typeof meta.dueAt === 'string' ? meta.dueAt : undefined,
                  supportingMetric: typeof meta.supportingMetric === 'string' ? meta.supportingMetric : undefined,
                  isManual: Boolean(meta.isManual),
                  createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : new Date().toISOString(),
                  statusWhenCreated: typeof meta.statusWhenCreated === 'string' ? meta.statusWhenCreated : undefined,
                };
              }
            }
          });
        }
        
        return { completions: { ...completions }, manualTasks: { ...manualTasks }, agentTasks: { ...agentTasks }, reminders, shownTasks, taskMetadata };
      }
      const entries = Object.values(record);
      const resemblesCompletionMap = entries.every((value) => {
        return value != null && typeof value === 'object' && 'completed' in (value as Record<string, unknown>);
      });
      if (resemblesCompletionMap) {
        return { completions: record as CompletionMap, manualTasks: {}, agentTasks: {}, reminders: defaultReminderState, shownTasks: {}, taskMetadata: {} };
      }
    }
  } catch (error) {
    console.warn('Unable to parse follow-up task storage payload', error);
  }
  return createDefaultTaskState();
};

export function FollowUpTaskProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, createDefaultTaskState(), () => {
    if (typeof window === 'undefined') {
      return createDefaultTaskState();
    }
    return parseFollowUpTaskState(window.localStorage.getItem(FOLLOW_UP_TASK_STORAGE_KEY));
  });

  const [isPending, startTransition] = useTransition();
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch reminder settings from the server on mount (source of truth for cron job)
  useEffect(() => {
    fetch('/api/me/reminders')
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (data && typeof data.enabled === 'boolean') {
          dispatch({
            type: 'set-global-reminders',
            settings: { enabled: data.enabled, frequency: data.frequency || 'daily' },
          });
        }
      })
      .catch(() => {
        // Silently ignore errors (e.g., user not logged in)
      });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === FOLLOW_UP_TASK_STORAGE_KEY) {
        dispatch({ type: 'hydrate', payload: parseFollowUpTaskState(event.newValue) });
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Debounced localStorage write to prevent blocking the UI
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule a debounced save
    saveTimeoutRef.current = setTimeout(() => {
      window.localStorage.setItem(FOLLOW_UP_TASK_STORAGE_KEY, JSON.stringify(state));
      saveTimeoutRef.current = null;
    }, 250);

    // Cleanup: ensure we save immediately on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Save immediately on unmount to prevent data loss
        window.localStorage.setItem(FOLLOW_UP_TASK_STORAGE_KEY, JSON.stringify(state));
        saveTimeoutRef.current = null;
      }
    };
  }, [state]);

  const toggleTask = useCallback((taskId: string, completed: boolean) => {
    startTransition(() => {
      dispatch({ type: 'toggle', taskId, completed });
    });
  }, [startTransition]);

  const generateManualId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as Crypto).randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const addManualTask = useCallback(
    (referralId: string, input: ManualTaskInput) => {
      const task: ManualTask = {
        id: generateManualId(),
        title: input.title,
        message: input.message,
        dueAt: input.dueAt ?? null,
        priority: input.priority,
        category: input.category,
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: 'add-manual', referralId, task });
    },
    []
  );

  const removeManualTask = useCallback((referralId: string, taskId: string) => {
    dispatch({ type: 'remove-manual', referralId, taskId });
  }, []);

  const addAgentTasks = useCallback((agentId: string, tasks: ManualTask[]) => {
    dispatch({ type: 'add-agent-tasks', agentId, tasks });
  }, []);

  const removeAgentTask = useCallback((agentId: string, taskId: string) => {
    dispatch({ type: 'remove-agent-task', agentId, taskId });
  }, []);

  const updateReminderSettings = useCallback((settings: ReminderSettings, referralId?: string) => {
    if (referralId) {
      dispatch({ type: 'set-referral-reminders', referralId, settings });
      return;
    }
    dispatch({ type: 'set-global-reminders', settings });

    // Sync global reminder settings to the server (required for cron job to work)
    fetch('/api/me/reminders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).catch(() => {
      // Silently ignore errors (optimistic update - localStorage already updated)
    });
  }, []);

  const clearReminderOverride = useCallback((referralId: string) => {
    dispatch({ type: 'set-referral-reminders', referralId, settings: null });
  }, []);

  const getReminderSettings = useCallback(
    (referralId?: string): ReminderSettings => {
      if (referralId && state.reminders.overrides[referralId]) {
        return state.reminders.overrides[referralId];
      }
      return state.reminders.global;
    },
    [state.reminders]
  );

  const hasReminderOverride = useCallback(
    (referralId: string) => Boolean(state.reminders.overrides[referralId]),
    [state.reminders.overrides]
  );

  const markTasksAsShown = useCallback((referralId: string, taskIds: string[]) => {
    dispatch({ type: 'mark-tasks-shown', referralId, taskIds });
  }, []);

  const storeTaskMetadata = useCallback((tasks: Array<{ taskId: string; metadata: TaskMetadata }>) => {
    dispatch({ type: 'store-task-metadata', tasks });
  }, []);

  const value = useMemo<FollowUpTaskContextValue>(
    () => ({
      completions: state.completions,
      manualTasks: state.manualTasks,
      agentTasks: state.agentTasks,
      shownTasks: state.shownTasks,
      taskMetadata: state.taskMetadata,
      toggleTask,
      addManualTask,
      removeManualTask,
      addAgentTasks,
      removeAgentTask,
      markTasksAsShown,
      storeTaskMetadata,
      reminderSettings: state.reminders.global,
      globalReminderSettings: state.reminders.global,
      reminderOverrides: state.reminders.overrides,
      getReminderSettings,
      updateReminderSettings,
      clearReminderOverride,
      hasReminderOverride,
    }),
    [
      state,
      toggleTask,
      addManualTask,
      removeManualTask,
      addAgentTasks,
      removeAgentTask,
      markTasksAsShown,
      storeTaskMetadata,
      updateReminderSettings,
      getReminderSettings,
      clearReminderOverride,
      hasReminderOverride,
    ]
  );

  return <FollowUpTaskContext.Provider value={value}>{children}</FollowUpTaskContext.Provider>;
}

export const useFollowUpTaskContext = (): FollowUpTaskContextValue => {
  const context = useContext(FollowUpTaskContext);
  if (!context) {
    throw new Error('useFollowUpTaskContext must be used within a FollowUpTaskProvider');
  }
  return context;
};
