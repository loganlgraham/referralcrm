'use client';

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';

import type { RecommendationPriority } from '@/utils/sla-insights';

interface TaskCompletionState {
  completed: boolean;
  completedAt?: string | null;
}

type CompletionMap = Record<string, TaskCompletionState>;

export type ManualTaskCategory = 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops';

interface ManualTask {
  id: string;
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
  createdAt: string;
}

interface ManualTaskInput {
  title: string;
  message: string;
  dueAt?: string | null;
  priority: RecommendationPriority;
  category: ManualTaskCategory;
}

interface StoredTaskState {
  completions: CompletionMap;
  manualTasks: Record<string, ManualTask[]>;
}

type Action =
  | { type: 'toggle'; taskId: string; completed: boolean }
  | { type: 'hydrate'; payload: StoredTaskState }
  | { type: 'add-manual'; referralId: string; task: ManualTask }
  | { type: 'remove-manual'; referralId: string; taskId: string };

interface FollowUpTaskContextValue {
  completions: CompletionMap;
  manualTasks: Record<string, ManualTask[]>;
  toggleTask: (taskId: string, completed: boolean) => void;
  addManualTask: (referralId: string, task: ManualTaskInput) => void;
  removeManualTask: (referralId: string, taskId: string) => void;
}

const STORAGE_KEY = 'referralcrm.followUpTasks';

const FollowUpTaskContext = createContext<FollowUpTaskContextValue | null>(null);

const defaultState: StoredTaskState = { completions: {}, manualTasks: {} };

const reducer = (state: StoredTaskState, action: Action): StoredTaskState => {
  switch (action.type) {
    case 'hydrate':
      return { ...defaultState, ...action.payload };
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
      return {
        ...state,
        manualTasks: {
          ...state.manualTasks,
          [action.referralId]: current.filter((task) => task.id !== action.taskId),
        },
        completions: nextCompletions,
      };
    }
    default:
      return state;
  }
};

const safeParse = (value: string | null): StoredTaskState => {
  if (!value) return defaultState;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if ('completions' in record || 'manualTasks' in record) {
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
        return { completions, manualTasks };
      }
      const entries = Object.values(record);
      const resemblesCompletionMap = entries.every((value) => {
        return value != null && typeof value === 'object' && 'completed' in (value as Record<string, unknown>);
      });
      if (resemblesCompletionMap) {
        return { completions: record as CompletionMap, manualTasks: {} };
      }
    }
  } catch (error) {
    console.warn('Unable to parse follow-up task storage payload', error);
  }
  return defaultState;
};

export function FollowUpTaskProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, defaultState, () => {
    if (typeof window === 'undefined') {
      return defaultState;
    }
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        dispatch({ type: 'hydrate', payload: safeParse(event.newValue) });
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const toggleTask = useCallback((taskId: string, completed: boolean) => {
    dispatch({ type: 'toggle', taskId, completed });
  }, []);

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

  const value = useMemo<FollowUpTaskContextValue>(
    () => ({
      completions: state.completions,
      manualTasks: state.manualTasks,
      toggleTask,
      addManualTask,
      removeManualTask,
    }),
    [state, toggleTask, addManualTask, removeManualTask]
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
