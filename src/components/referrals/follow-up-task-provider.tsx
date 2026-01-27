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
import { useSession } from 'next-auth/react';

import type { RecommendationPriority } from '@/utils/sla-insights';
import type {
  ManualTask,
  ManualTaskInput,
} from '@/types/follow-up-tasks';

export type { ManualTask, ManualTaskInput } from '@/types/follow-up-tasks';

const generateManualId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
};

interface TaskCompletionState {
  completed: boolean;
  completedAt?: string | null;
}

type CompletionMap = Record<string, TaskCompletionState>;

export type ReminderFrequency = 'daily' | 'weekly';

interface ReminderSettings {
  enabled: boolean;
  frequency: ReminderFrequency;
}

interface ReminderState {
  global: ReminderSettings;
  overrides: Record<string, ReminderSettings>;
}

export type ManualTaskCategory = ManualTask['category'];

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
  | { type: 'toggle'; taskId: string; completed: boolean; completedAt: string | null }
  | { type: 'hydrate'; payload: StoredTaskState }
  | {
      type: 'merge-referrals';
      referralIds: string[];
      payload: Pick<StoredTaskState, 'completions' | 'manualTasks' | 'shownTasks' | 'taskMetadata'>;
    }
  | { type: 'add-manual'; referralId: string; task: ManualTask }
  | { type: 'remove-manual'; referralId: string; taskId: string }
  | { type: 'set-manual-tasks'; referralId: string; tasks: ManualTask[] }
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
  toggleTask: (taskId: string, completed: boolean) => Promise<void>;
  addManualTask: (referralId: string, task: ManualTaskInput) => Promise<void>;
  removeManualTask: (referralId: string, taskId: string) => Promise<void>;
  addAgentTasks: (agentId: string, tasks: ManualTask[]) => void;
  removeAgentTask: (agentId: string, taskId: string) => void;
  markTasksAsShown: (referralId: string, taskIds: string[]) => void;
  storeTaskMetadata: (tasks: Array<{ taskId: string; metadata: TaskMetadata }>) => void;
  loadReferralStates: (referralIds: string[], forceRefresh?: boolean) => Promise<void>;
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
    case 'merge-referrals': {
      const nextManualTasks = { ...state.manualTasks };
      const nextShownTasks = { ...state.shownTasks };
      const nextMetadata = { ...state.taskMetadata };

      // Build prefixes for all referral IDs being merged
      const prefixesToRemove = action.referralIds.map((referralId) => `${referralId}::`);

      // Build merged completions atomically: keep non-matching, replace matching
      // This prevents the flash where completions are temporarily missing
      const mergedCompletions: CompletionMap = {};
      
      // First, copy all completions that don't match any of the referral prefixes
      Object.entries(state.completions).forEach(([taskId, completion]) => {
        const shouldRemove = prefixesToRemove.some((prefix) => taskId.startsWith(prefix));
        if (!shouldRemove) {
          mergedCompletions[taskId] = completion;
        }
      });
      
      // Then merge in the new completions from the payload (this overwrites any matching keys)
      Object.assign(mergedCompletions, action.payload.completions);

      // Update metadata atomically in the same way
      const mergedMetadata: Record<string, TaskMetadata> = {};
      Object.entries(state.taskMetadata).forEach(([taskId, metadata]) => {
        const shouldRemove = prefixesToRemove.some((prefix) => taskId.startsWith(prefix));
        if (!shouldRemove) {
          mergedMetadata[taskId] = metadata;
        }
      });
      Object.assign(mergedMetadata, action.payload.taskMetadata);

      // Update manual tasks and shown tasks
      for (const referralId of action.referralIds) {
        nextManualTasks[referralId] = action.payload.manualTasks[referralId] ?? [];
        nextShownTasks[referralId] = action.payload.shownTasks[referralId] ?? [];
      }

      return {
        ...state,
        completions: mergedCompletions,
        manualTasks: { ...nextManualTasks },
        shownTasks: { ...nextShownTasks },
        taskMetadata: mergedMetadata,
      };
    }
    case 'toggle': {
      const nextCompletions: CompletionMap = { ...state.completions };
      nextCompletions[action.taskId] = {
        completed: action.completed,
        completedAt: action.completedAt,
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
    case 'set-manual-tasks': {
      return {
        ...state,
        manualTasks: {
          ...state.manualTasks,
          [action.referralId]: action.tasks,
        },
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
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  // Always start with empty state - we'll load from localStorage in an effect for non-admin users
  // Admin users skip localStorage entirely and rely on server state
  const [state, dispatch] = useReducer(reducer, createDefaultTaskState(), () => {
    if (typeof window === 'undefined') {
      return createDefaultTaskState();
    }
    // Always start empty - localStorage will be loaded in effect if user is not admin
    return createDefaultTaskState();
  });

  const [, startTransition] = useTransition();
  const stateRef = useRef(state);
  type DebouncedSyncEntry = { timeoutId: NodeJS.Timeout; controller: AbortController };
  const debouncedSyncRef = useRef<Map<string, DebouncedSyncEntry>>(new Map());
  const inFlightSyncsRef = useRef<Map<string, AbortController>>(new Map());
  const pendingCompletionUpdatesRef = useRef<Map<string, Record<string, { completed: boolean; completedAt: string | null }>>>(new Map());
  const loadedReferralsRef = useRef<Set<string>>(new Set());
  const allowLocalCacheRef = useRef(false);
  const isMountedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Clear loaded referrals on mount to ensure fresh data on page load/refresh
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      loadedReferralsRef.current.clear();
      console.log('[Task Load] Cleared loaded referrals cache on mount - will fetch fresh data');
    }
  }, []);

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

  // For non-admin users, load from localStorage after session is available
  // Admin users skip localStorage entirely and rely on server state
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    // Wait for session to be determined
    if (session === undefined) {
      return;
    }
    // Admin users should never use localStorage
    if (isAdmin) {
      return;
    }
    // For non-admin users, load from localStorage if available
    const stored = window.localStorage.getItem(FOLLOW_UP_TASK_STORAGE_KEY);
    if (stored) {
      const parsed = parseFollowUpTaskState(stored);
      if (parsed && (Object.keys(parsed.completions).length > 0 || Object.keys(parsed.manualTasks).length > 0)) {
        dispatch({ type: 'hydrate', payload: parsed });
      }
    }
  }, [session, isAdmin]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const updateCachePreference = () => {
      allowLocalCacheRef.current = !navigator.onLine;
    };
    updateCachePreference();
    window.addEventListener('online', updateCachePreference);
    window.addEventListener('offline', updateCachePreference);
    return () => {
      window.removeEventListener('online', updateCachePreference);
      window.removeEventListener('offline', updateCachePreference);
    };
  }, []);

  // localStorage writes removed - MongoDB is now the source of truth
  // Keeping this effect empty for now to maintain structure
  useEffect(() => {
    // No longer writing to localStorage - MongoDB is authoritative
  }, [state, isAdmin]);

  // Cleanup: abort all in-flight syncs and clear debounced syncs on unmount
  useEffect(() => {
    return () => {
      // Abort all in-flight immediate syncs
      for (const controller of inFlightSyncsRef.current.values()) {
        controller.abort();
      }
      inFlightSyncsRef.current.clear();

      // Clear all debounced syncs (clear timeouts and abort controllers)
      for (const entry of debouncedSyncRef.current.values()) {
        clearTimeout(entry.timeoutId);
        entry.controller.abort();
      }
      debouncedSyncRef.current.clear();
    };
  }, []);

  const getReferralIdFromTaskId = useCallback((taskId: string): string | null => {
    const [referralId] = taskId.split('::');
    return referralId || null;
  }, []);

  const buildReferralPayload = useCallback(
    (
      referralId: string,
      currentState: StoredTaskState,
      completionUpdates?: Record<string, { completed: boolean; completedAt?: string | null }>
    ) => {
      const prefix = `${referralId}::`;
      let completions = Object.fromEntries(
        Object.entries(currentState.completions).filter(([taskId]) => taskId.startsWith(prefix))
      );
      
      // Merge in any direct completion updates (to fix race condition)
      if (completionUpdates) {
        completions = { ...completions, ...completionUpdates };
      }
      
      const taskMetadata = Object.fromEntries(
        Object.entries(currentState.taskMetadata).filter(([taskId]) => taskId.startsWith(prefix))
      );

      return {
        completions,
        manualTasks: currentState.manualTasks[referralId] ?? [],
        shownTasks: currentState.shownTasks[referralId] ?? [],
        taskMetadata,
      };
    },
    []
  );

  const syncReferralState = useCallback(
    async (
      referralId: string,
      skipMerge = false,
      completionUpdates?: Record<string, { completed: boolean; completedAt?: string | null }>,
      abortSignal?: AbortSignal
    ) => {
      const payload = buildReferralPayload(referralId, stateRef.current, completionUpdates);
    const manualTasksCount = payload.manualTasks?.length ?? 0;
    const completionsCount = Object.keys(payload.completions ?? {}).length;

    console.log(`[Task Sync] Syncing referral ${referralId}: ${manualTasksCount} manual tasks, ${completionsCount} completions`);

    // Debounced sync (no completionUpdates): omit completions when empty so we never overwrite
    // server completions with an empty array (e.g. legacy state keys filtered out by prefix).
    // Check if completionUpdates has actual entries, not just if it's truthy (empty objects are truthy)
    const hasCompletionUpdates = completionUpdates && Object.keys(completionUpdates).length > 0;
    const omitCompletions =
      !hasCompletionUpdates && Object.keys(payload.completions ?? {}).length === 0;
    const body = omitCompletions
      ? (() => {
          const { completions: _c, ...rest } = payload;
          return rest;
        })()
      : payload;

    try {
      const response = await fetch(`/api/follow-up-tasks/${referralId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      
      // Check if request was aborted
      if (abortSignal?.aborted) {
        console.log(`[Task Sync] Request for referral ${referralId} was aborted`);
        return false;
      }
      
      if (!response.ok) {
        throw new Error('Failed to sync follow-up tasks');
      }
      const data = await response.json();
      
      // Check again after async operation (abort may have happened during fetch)
      if (abortSignal?.aborted) {
        console.log(`[Task Sync] Request for referral ${referralId} was aborted after response`);
        return false;
      }
      
      if (data?.state && !skipMerge) {
        const serverManualTasksCount = data.state.manualTasks?.length ?? 0;
        console.log(`[Task Sync] Successfully synced referral ${referralId}: ${serverManualTasksCount} manual tasks on server`);
        dispatch({
          type: 'merge-referrals',
          referralIds: [referralId],
          payload: {
            completions: data.state.completions ?? {},
            manualTasks: { [referralId]: data.state.manualTasks ?? [] },
            shownTasks: { [referralId]: data.state.shownTasks ?? [] },
            taskMetadata: data.state.taskMetadata ?? {},
          },
        });
      } else if (skipMerge) {
        console.log(`[Task Sync] Successfully synced referral ${referralId} (skipping merge to preserve optimistic update)`);
      }
      allowLocalCacheRef.current = false;
      return true;
    } catch (error) {
      // Ignore AbortError - it's expected when canceling previous requests
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(`[Task Sync] Request for referral ${referralId} was aborted`);
        return false;
      }
      console.error(`[Task Sync] Failed to sync referral ${referralId}:`, error);
      allowLocalCacheRef.current = true;
      return false;
    }
  }, [buildReferralPayload]);

  const scheduleReferralSync = useCallback(
    (referralId: string) => {
      if (typeof window === 'undefined') {
        return;
      }
      const existing = debouncedSyncRef.current.get(referralId);
      if (existing) {
        clearTimeout(existing.timeoutId);
        existing.controller.abort();
        debouncedSyncRef.current.delete(referralId);
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        const entry = debouncedSyncRef.current.get(referralId);
        if (!entry) return;
        const ctrl = entry.controller;
        void syncReferralState(referralId, false, undefined, ctrl.signal).finally(() => {
          if (debouncedSyncRef.current.get(referralId)?.controller === ctrl) {
            debouncedSyncRef.current.delete(referralId);
          }
        });
      }, 250);
      debouncedSyncRef.current.set(referralId, { timeoutId, controller });
    },
    [syncReferralState]
  );

  // Immediate sync for critical operations like toggles
  const syncReferralStateImmediate = useCallback(
    async (
      referralId: string,
      skipMerge = false,
      completionUpdates?: Record<string, { completed: boolean; completedAt?: string | null }>
    ): Promise<boolean> => {
      if (typeof window === 'undefined') {
        return false;
      }
      // Cancel any pending or in-flight debounced sync for this referral so it cannot
      // complete later and overwrite our optimistic toggle with stale server completions.
      const debounced = debouncedSyncRef.current.get(referralId);
      if (debounced) {
        clearTimeout(debounced.timeoutId);
        debounced.controller.abort();
        debouncedSyncRef.current.delete(referralId);
      }
      
      // Cancel any in-flight immediate sync for this referral to prevent race conditions
      const inFlightController = inFlightSyncsRef.current.get(referralId);
      let mergedCompletionUpdates: Record<string, { completed: boolean; completedAt: string | null }> = {};
      
      // Normalize completionUpdates to ensure completedAt is always string | null (not undefined)
      if (completionUpdates) {
        for (const [taskId, update] of Object.entries(completionUpdates)) {
          mergedCompletionUpdates[taskId] = {
            completed: update.completed,
            completedAt: update.completedAt ?? null,
          };
        }
      }
      
      if (inFlightController) {
        console.log(`[Task Sync] Canceling previous in-flight sync for referral ${referralId}`);
        
        // Merge pending completion updates from the aborted sync to prevent data loss
        const pendingUpdates = pendingCompletionUpdatesRef.current.get(referralId);
        if (pendingUpdates) {
          mergedCompletionUpdates = { ...pendingUpdates, ...mergedCompletionUpdates };
          console.log(`[Task Sync] Merging ${Object.keys(pendingUpdates).length} pending completion updates from aborted sync`);
        }
        
        inFlightController.abort();
        inFlightSyncsRef.current.delete(referralId);
      }
      
      // Store the merged completion updates as pending (will be cleared on successful sync)
      if (Object.keys(mergedCompletionUpdates).length > 0) {
        pendingCompletionUpdatesRef.current.set(referralId, mergedCompletionUpdates);
      }
      
      // Create new AbortController for this sync
      const abortController = new AbortController();
      inFlightSyncsRef.current.set(referralId, abortController);
      
      try {
        // Perform immediate sync with merged completion updates
        const result = await syncReferralState(referralId, skipMerge, mergedCompletionUpdates, abortController.signal);
        
        // Clean up on success (only if this controller is still the active one)
        if (inFlightSyncsRef.current.get(referralId) === abortController) {
          inFlightSyncsRef.current.delete(referralId);
          // Clear pending updates after successful sync
          pendingCompletionUpdatesRef.current.delete(referralId);
        }
        
        return result;
      } catch (error) {
        // Clean up on error (only if this controller is still the active one)
        if (inFlightSyncsRef.current.get(referralId) === abortController) {
          inFlightSyncsRef.current.delete(referralId);
          // Don't clear pending updates on error - they'll be retried in the next sync
        }
        throw error;
      }
    },
    [syncReferralState]
  );

  const loadReferralStates = useCallback(async (referralIds: string[], forceRefresh = false) => {
    if (typeof window === 'undefined') {
      return;
    }
    
    // Always fetch fresh data from server - don't rely on cached refs
    // This ensures manual tasks are always visible after refresh
    const idsToLoad = referralIds.filter((id) => id);
    if (idsToLoad.length === 0) {
      return;
    }
    
    // If forcing refresh, clear the loaded refs for these referrals
    if (forceRefresh) {
      idsToLoad.forEach((id) => loadedReferralsRef.current.delete(id));
    }
    
    // Filter out only referrals that haven't been loaded yet (unless forcing refresh)
    const idsToFetch = forceRefresh 
      ? idsToLoad 
      : idsToLoad.filter((id) => !loadedReferralsRef.current.has(id));
    
    if (idsToFetch.length === 0) {
      return;
    }
    
    console.log(`[Task Load] Loading task states for referrals: ${idsToFetch.join(', ')}${forceRefresh ? ' (forced refresh)' : ''}`);
    const params = new URLSearchParams({ referralIds: idsToFetch.join(',') });
    try {
      // Always add cache-busting parameter to ensure fresh data across different users/sessions
      const cacheBuster = `&_t=${Date.now()}`;
      const response = await fetch(`/api/follow-up-tasks?${params.toString()}${cacheBuster}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to load follow-up task state');
      }
      const data = await response.json();
      if (data?.referrals && typeof data.referrals === 'object') {
        const completions: CompletionMap = {};
        const manualTasks: Record<string, ManualTask[]> = {};
        const shownTasks: Record<string, string[]> = {};
        const taskMetadata: Record<string, TaskMetadata> = {};

        const referrals = data.referrals as Record<
          string,
          {
            completions?: CompletionMap;
            manualTasks?: ManualTask[];
            shownTasks?: string[];
            taskMetadata?: Record<string, TaskMetadata>;
          }
        >;

        Object.entries(referrals).forEach(([referralId, state]) => {
          Object.assign(completions, state?.completions ?? {});
          manualTasks[referralId] = Array.isArray(state?.manualTasks) ? state.manualTasks : [];
          shownTasks[referralId] = Array.isArray(state?.shownTasks) ? state.shownTasks : [];
          Object.assign(taskMetadata, state?.taskMetadata ?? {});
          loadedReferralsRef.current.add(referralId);
          const taskCount = manualTasks[referralId]?.length ?? 0;
          console.log(`[Task Load] Loaded ${taskCount} manual tasks for referral ${referralId}`);
          
          // Log completion entries for manual tasks to verify persistence
          if (process.env.NODE_ENV === 'development' && taskCount > 0) {
            const manualTaskIds = manualTasks[referralId].map((task) => `${referralId}::manual::${task.id}`);
            const manualCompletions = Object.entries(state?.completions ?? {})
              .filter(([taskId]) => manualTaskIds.includes(taskId))
              .map(([taskId, completion]) => ({ 
                taskId, 
                completion: completion as TaskCompletionState 
              }));
            console.log(`[Task Load] Manual task completions for referral ${referralId}:`, manualCompletions);
            const completedManualCount = manualCompletions.filter((entry) => entry.completion?.completed).length;
            console.log(`[Task Load] ${completedManualCount} of ${taskCount} manual tasks are completed for referral ${referralId}`);
          }
        });

        // Always use server state as authoritative - merge-referrals clears old state first
        dispatch({
          type: 'merge-referrals',
          referralIds: idsToFetch,
          payload: { completions, manualTasks, shownTasks, taskMetadata },
        });
        allowLocalCacheRef.current = false;
      }
    } catch (error) {
      console.error(`[Task Load] Failed to load task states:`, error);
      allowLocalCacheRef.current = true;
    }
  }, [isAdmin]);

  const toggleTask = useCallback(
    async (taskId: string, completed: boolean) => {
      const referralId = getReferralIdFromTaskId(taskId);
      const isManualTask = taskId.includes('::manual::');
      console.log(`[Task CRUD] Toggling task ${taskId} to ${completed ? 'completed' : 'incomplete'}${isManualTask ? ' (manual task)' : ''}`);
      
      // Generate completedAt once and use it for both local state and server payload
      const completedAt = completed ? new Date().toISOString() : null;
      
      // Optimistic update
      startTransition(() => {
        dispatch({ type: 'toggle', taskId, completed, completedAt });
      });
      
      if (referralId) {
        try {
          // Fetch tasks to get MongoDB _id mapping
          const tasksResponse = await fetch(`/api/referrals/${referralId}/tasks?includeCompleted=true`);
          if (!tasksResponse.ok) {
            throw new Error('Failed to fetch tasks');
          }
          const tasks = await tasksResponse.json();
          
          // Find the task by matching ruleId or manual task
          let taskMongoId: string | null = null;
          if (isManualTask) {
            // For manual tasks, match by extracting the manual task ID
            const manualTaskId = taskId.split('::manual::')[1];
            const task = tasks.find((t: any) => 
              t.source === 'manual' && 
              (t.ruleId === manualTaskId || t._id === manualTaskId)
            );
            taskMongoId = task?._id;
          } else {
            // For system tasks, match by ruleId
            const ruleId = taskId.split('::')[1];
            const task = tasks.find((t: any) => t.ruleId === ruleId && t.source === 'static');
            taskMongoId = task?._id;
          }
          
          if (taskMongoId) {
            // Call the new API endpoint
            const response = await fetch(`/api/tasks/${taskMongoId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                status: completed ? 'completed' : 'open',
                completedAt: completedAt 
              }),
            });
            
            if (!response.ok) {
              throw new Error('Failed to update task');
            }
          } else {
            // Fallback to old sync method if task not found
            const completionUpdates: Record<string, { completed: boolean; completedAt: string | null }> = {
              [taskId]: { completed, completedAt },
            };
            await syncReferralStateImmediate(referralId, true, completionUpdates);
          }
        } catch (error) {
          console.error(`[Task CRUD] Failed to sync task toggle ${taskId}:`, error);
          // The optimistic update has already been applied to the UI.
        }
      }
    },
    [getReferralIdFromTaskId, syncReferralStateImmediate, startTransition]
  );

  const addManualTask = useCallback(
    async (referralId: string, input: ManualTaskInput) => {
      const task: ManualTask = {
        id: generateManualId(),
        title: input.title,
        message: input.message,
        dueAt: input.dueAt ?? null,
        priority: input.priority,
        category: input.category,
        createdAt: new Date().toISOString(),
      };
      console.log(`[Task CRUD] Creating manual task "${task.title}" (${task.id}) for referral ${referralId}`);
      
      // Update local state optimistically
      startTransition(() => {
        dispatch({ type: 'add-manual', referralId, task });
      });
      
      // Use immediate sync to ensure persistence and prevent "flash and disappear" issue
      // Skip merge to preserve optimistic update
      await syncReferralStateImmediate(referralId, true);
    },
    [syncReferralStateImmediate, startTransition]
  );

  const removeManualTask = useCallback(
    async (referralId: string, taskId: string) => {
      console.log(`[Task CRUD] Deleting manual task ${taskId} from referral ${referralId}`);
      
      // Update local state optimistically
      startTransition(() => {
        dispatch({ type: 'remove-manual', referralId, taskId });
      });
      
      // Use immediate sync to ensure persistence and prevent "flash and disappear" issue
      // Skip merge to preserve optimistic update
      await syncReferralStateImmediate(referralId, true);
    },
    [syncReferralStateImmediate, startTransition]
  );


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
    scheduleReferralSync(referralId);
  }, [scheduleReferralSync]);

  const storeTaskMetadata = useCallback((tasks: Array<{ taskId: string; metadata: TaskMetadata }>) => {
    dispatch({ type: 'store-task-metadata', tasks });
    const referralIds = new Set<string>();
    tasks.forEach((task) => {
      const referralId = getReferralIdFromTaskId(task.taskId);
      if (referralId) {
        referralIds.add(referralId);
      }
    });
    referralIds.forEach((referralId) => {
      scheduleReferralSync(referralId);
    });
  }, [getReferralIdFromTaskId, scheduleReferralSync]);

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
      loadReferralStates,
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
      loadReferralStates,
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
