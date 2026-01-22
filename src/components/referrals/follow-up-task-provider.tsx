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
  | { type: 'toggle'; taskId: string; completed: boolean }
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
  addManualTask: (referralId: string, task: ManualTaskInput) => void;
  removeManualTask: (referralId: string, taskId: string) => void;
  addAgentTasks: (agentId: string, tasks: ManualTask[]) => void;
  removeAgentTask: (agentId: string, taskId: string) => void;
  markTasksAsShown: (referralId: string, taskIds: string[]) => void;
  storeTaskMetadata: (tasks: Array<{ taskId: string; metadata: TaskMetadata }>) => void;
  loadReferralStates: (referralIds: string[]) => void;
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
      // TEMPORARY LOGGING: Log merge operation
      console.log(`[Merge DEBUG] merge-referrals for referralIds: ${action.referralIds.join(', ')}`);
      const beforeCompletionsCount = Object.keys(state.completions).length;
      console.log(`[Merge DEBUG] Before merge: ${beforeCompletionsCount} total completions in state`);
      
      const nextCompletions = { ...state.completions };
      const nextManualTasks = { ...state.manualTasks };
      const nextShownTasks = { ...state.shownTasks };
      const nextMetadata = { ...state.taskMetadata };

      for (const referralId of action.referralIds) {
        const prefix = `${referralId}::`;
        const beforeDelete = Object.keys(nextCompletions).filter((taskId) => taskId.startsWith(prefix));
        console.log(`[Merge DEBUG] Referral ${referralId}: Deleting ${beforeDelete.length} existing completions`);
        beforeDelete.forEach((taskId) => {
          console.log(`[Merge DEBUG]   - Deleting: ${taskId}, completed: ${nextCompletions[taskId]?.completed}`);
        });
        
        Object.keys(nextCompletions).forEach((taskId) => {
          if (taskId.startsWith(prefix)) {
            delete nextCompletions[taskId];
          }
        });
        Object.keys(nextMetadata).forEach((taskId) => {
          if (taskId.startsWith(prefix)) {
            delete nextMetadata[taskId];
          }
        });
        nextManualTasks[referralId] = action.payload.manualTasks[referralId] ?? [];
        nextShownTasks[referralId] = action.payload.shownTasks[referralId] ?? [];
      }

      const payloadCompletionsCount = Object.keys(action.payload.completions ?? {}).length;
      console.log(`[Merge DEBUG] Payload contains ${payloadCompletionsCount} completions to merge`);
      Object.entries(action.payload.completions ?? {}).forEach(([taskId, completionState]) => {
        console.log(`[Merge DEBUG]   - Merging: ${taskId}, completed: ${completionState?.completed}, completedAt: ${completionState?.completedAt ?? 'null'}`);
      });

      const mergedCompletions = { ...nextCompletions, ...action.payload.completions };
      const afterCompletionsCount = Object.keys(mergedCompletions).length;
      console.log(`[Merge DEBUG] After merge: ${afterCompletionsCount} total completions in state`);

      return {
        ...state,
        completions: mergedCompletions,
        manualTasks: { ...nextManualTasks },
        shownTasks: { ...nextShownTasks },
        taskMetadata: { ...nextMetadata, ...action.payload.taskMetadata },
      };
    }
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
  const syncTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const loadedReferralsRef = useRef<Set<string>>(new Set());
  const allowLocalCacheRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  // Prevent localStorage writes for admin users to avoid conflicts
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    // Skip localStorage writes for admin users - server is authoritative
    if (isAdmin) {
      return;
    }
    if (!allowLocalCacheRef.current) {
      return;
    }
    window.localStorage.setItem(FOLLOW_UP_TASK_STORAGE_KEY, JSON.stringify(state));
  }, [state, isAdmin]);

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
      completionUpdates?: Record<string, { completed: boolean; completedAt?: string | null }>
    ) => {
      // TEMPORARY LOGGING: Log what stateRef.current contains
      const prefix = `${referralId}::`;
      const currentCompletionsForReferral = Object.entries(stateRef.current.completions)
        .filter(([taskId]) => taskId.startsWith(prefix));
      console.log(`[Task Sync DEBUG] stateRef.current.completions for referral ${referralId}: ${currentCompletionsForReferral.length} entries`);
      currentCompletionsForReferral.forEach(([taskId, completionState]) => {
        console.log(`[Task Sync DEBUG]   - taskId: ${taskId}, completed: ${completionState?.completed}, completedAt: ${completionState?.completedAt ?? 'null'}`);
      });
      if (completionUpdates) {
        console.log(`[Task Sync DEBUG] Direct completion updates provided: ${Object.keys(completionUpdates).length} entries`);
        Object.entries(completionUpdates).forEach(([taskId, completionState]) => {
          console.log(`[Task Sync DEBUG]   - taskId: ${taskId}, completed: ${completionState?.completed}, completedAt: ${completionState?.completedAt ?? 'null'}`);
        });
      }
      console.log(`[Task Sync DEBUG] skipMerge: ${skipMerge}`);
      
      const payload = buildReferralPayload(referralId, stateRef.current, completionUpdates);
    const manualTasksCount = payload.manualTasks?.length ?? 0;
    const completionsCount = Object.keys(payload.completions ?? {}).length;

    console.log(`[Task Sync] Syncing referral ${referralId}: ${manualTasksCount} manual tasks, ${completionsCount} completions`);
    
    // TEMPORARY LOGGING: Log what payload we're sending
    const payloadCompletions = Object.entries(payload.completions ?? {});
    console.log(`[Task Sync DEBUG] Payload being sent - ${payloadCompletions.length} completions:`);
    payloadCompletions.forEach(([taskId, completionState]) => {
      console.log(`[Task Sync DEBUG]   - taskId: ${taskId}, completed: ${completionState?.completed}, completedAt: ${completionState?.completedAt ?? 'null'}`);
    });

    try {
      const response = await fetch(`/api/follow-up-tasks/${referralId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error('Failed to sync follow-up tasks');
      }
      const data = await response.json();
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
      const existing = syncTimeoutsRef.current.get(referralId);
      if (existing) {
        clearTimeout(existing);
      }
      const timeout = setTimeout(() => {
        syncTimeoutsRef.current.delete(referralId);
        void syncReferralState(referralId);
      }, 250);
      syncTimeoutsRef.current.set(referralId, timeout);
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
      // Cancel any pending debounced sync for this referral
      const existing = syncTimeoutsRef.current.get(referralId);
      if (existing) {
        clearTimeout(existing);
        syncTimeoutsRef.current.delete(referralId);
      }
      // Perform immediate sync
      return await syncReferralState(referralId, skipMerge, completionUpdates);
    },
    [syncReferralState]
  );

  const loadReferralStates = useCallback(async (referralIds: string[]) => {
    if (typeof window === 'undefined') {
      return;
    }
    // TEMPORARY LOGGING: Log what we're checking
    const allReferralIds = new Set(referralIds);
    const previouslyLoaded = Array.from(loadedReferralsRef.current);
    console.log(`[Task Load DEBUG] Requested referralIds: ${referralIds.join(', ')}`);
    console.log(`[Task Load DEBUG] Previously loaded: ${previouslyLoaded.join(', ')}`);
    
    // Clear loaded ref if referralIds have changed significantly (e.g., page navigation)
    // This ensures we reload on refresh even if ref persisted somehow
    const hasNewReferrals = referralIds.some((id) => !loadedReferralsRef.current.has(id));
    if (hasNewReferrals && referralIds.length > 0) {
      // Only keep loaded refs that are still in the current referral list
      const currentSet = new Set(referralIds);
      const toRemove = Array.from(loadedReferralsRef.current).filter((id) => !currentSet.has(id));
      toRemove.forEach((id) => loadedReferralsRef.current.delete(id));
      if (toRemove.length > 0) {
        console.log(`[Task Load DEBUG] Cleared ${toRemove.length} stale loaded referrals: ${toRemove.join(', ')}`);
      }
    }
    
    const idsToLoad = referralIds.filter((id) => id && !loadedReferralsRef.current.has(id));
    console.log(`[Task Load DEBUG] IDs to load (after filtering): ${idsToLoad.join(', ')}`);
    if (idsToLoad.length === 0) {
      console.log(`[Task Load DEBUG] All referrals already loaded, skipping fetch`);
      return;
    }
    console.log(`[Task Load] Loading task states for referrals: ${idsToLoad.join(', ')}`);
    const params = new URLSearchParams({ referralIds: idsToLoad.join(',') });
    try {
      const response = await fetch(`/api/follow-up-tasks?${params.toString()}`);
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
          // TEMPORARY LOGGING: Log what we received from API
          if (state?.completions && typeof state.completions === 'object') {
            const completionEntries = Object.entries(state.completions);
            console.log(`[Task Load DEBUG] Referral ${referralId} - Received ${completionEntries.length} completions from API:`);
            completionEntries.forEach(([taskId, completionState]) => {
              console.log(`[Task Load DEBUG]   - taskId: ${taskId}, completed: ${completionState?.completed}, completedAt: ${completionState?.completedAt ?? 'null'}`);
            });
          } else {
            console.log(`[Task Load DEBUG] Referral ${referralId} - No completions received from API`);
          }
          
          Object.assign(completions, state?.completions ?? {});
          manualTasks[referralId] = Array.isArray(state?.manualTasks) ? state.manualTasks : [];
          shownTasks[referralId] = Array.isArray(state?.shownTasks) ? state.shownTasks : [];
          Object.assign(taskMetadata, state?.taskMetadata ?? {});
          loadedReferralsRef.current.add(referralId);
          const taskCount = manualTasks[referralId]?.length ?? 0;
          console.log(`[Task Load] Loaded ${taskCount} manual tasks for referral ${referralId}`);
        });

        // TEMPORARY LOGGING: Log what we're about to merge
        const allCompletionEntries = Object.entries(completions);
        console.log(`[Task Load DEBUG] About to merge ${allCompletionEntries.length} total completions into state`);
        allCompletionEntries.forEach(([taskId, completionState]) => {
          console.log(`[Task Load DEBUG]   - taskId: ${taskId}, completed: ${completionState?.completed}, completedAt: ${completionState?.completedAt ?? 'null'}`);
        });

        // For admin users, merge-referrals already clears old state for these referrals first,
        // ensuring server state is authoritative. For non-admin users, merge combines with localStorage.
        dispatch({
          type: 'merge-referrals',
          referralIds: idsToLoad,
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
      console.log(`[Task CRUD] Toggling task ${taskId} to ${completed ? 'completed' : 'incomplete'}`);
      
      // Build the completion update directly to avoid race condition with stateRef
      const completedAt = completed ? new Date().toISOString() : null;
      const completionUpdates: Record<string, { completed: boolean; completedAt: string | null }> = {
        [taskId]: { completed, completedAt },
      };
      
      startTransition(() => {
        dispatch({ type: 'toggle', taskId, completed });
      });
      if (referralId) {
        // Use immediate sync for toggles to ensure persistence before page refresh
        // Pass completion state directly to avoid race condition with stateRef
        // Skip merge to preserve optimistic update and prevent flickering
        await syncReferralStateImmediate(referralId, true, completionUpdates);
      }
    },
    [getReferralIdFromTaskId, syncReferralStateImmediate, startTransition]
  );

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
      console.log(`[Task CRUD] Creating manual task "${task.title}" (${task.id}) for referral ${referralId}`);
      dispatch({ type: 'add-manual', referralId, task });
      scheduleReferralSync(referralId);
    },
    [scheduleReferralSync]
  );

  const removeManualTask = useCallback((referralId: string, taskId: string) => {
    console.log(`[Task CRUD] Deleting manual task ${taskId} from referral ${referralId}`);
    dispatch({ type: 'remove-manual', referralId, taskId });
    scheduleReferralSync(referralId);
  }, [scheduleReferralSync]);


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
