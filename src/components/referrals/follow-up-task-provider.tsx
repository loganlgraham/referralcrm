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

interface TaskCompletionState {
  completed: boolean;
  completedAt?: string | null;
}

type CompletionMap = Record<string, TaskCompletionState>;

type Action =
  | { type: 'toggle'; taskId: string; completed: boolean }
  | { type: 'hydrate'; payload: CompletionMap };

interface FollowUpTaskContextValue {
  completions: CompletionMap;
  toggleTask: (taskId: string, completed: boolean) => void;
}

const STORAGE_KEY = 'referralcrm.followUpTasks';

const FollowUpTaskContext = createContext<FollowUpTaskContextValue | null>(null);

const reducer = (state: CompletionMap, action: Action): CompletionMap => {
  switch (action.type) {
    case 'hydrate':
      return { ...action.payload };
    case 'toggle': {
      const next: CompletionMap = { ...state };
      next[action.taskId] = {
        completed: action.completed,
        completedAt: action.completed ? new Date().toISOString() : null,
      };
      return next;
    }
    default:
      return state;
  }
};

const safeParse = (value: string | null): CompletionMap => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as CompletionMap;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (error) {
    console.warn('Unable to parse follow-up task storage payload', error);
  }
  return {};
};

export function FollowUpTaskProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {}, () => {
    if (typeof window === 'undefined') {
      return {};
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

  const value = useMemo<FollowUpTaskContextValue>(
    () => ({
      completions: state,
      toggleTask,
    }),
    [state, toggleTask]
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
