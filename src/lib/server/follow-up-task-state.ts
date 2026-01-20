import type {
  FollowUpManualTask,
  FollowUpTaskCompletion,
  FollowUpTaskMetadata,
  FollowUpTaskStateDocument,
} from '@/models/follow-up-task-state';

export interface FollowUpTaskStatePayload {
  completions: Record<string, { completed: boolean; completedAt?: string | null }>;
  manualTasks: FollowUpManualTask[];
  shownTasks: string[];
  taskMetadata: Record<string, FollowUpTaskMetadata>;
}

const PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);
const CATEGORIES = new Set(['assignment', 'communication', 'pipeline', 'finance', 'ops']);

type FollowUpTaskStateLike = Pick<
  FollowUpTaskStateDocument,
  'completions' | 'manualTasks' | 'shownTasks' | 'taskMetadata'
>;

export const buildStateFromDocument = (doc: FollowUpTaskStateLike | null): FollowUpTaskStatePayload => {
  if (!doc) {
    return { completions: {}, manualTasks: [], shownTasks: [], taskMetadata: {} };
  }

  const completions: FollowUpTaskStatePayload['completions'] = {};
  for (const completion of doc.completions ?? []) {
    completions[completion.taskId] = {
      completed: completion.completed,
      completedAt: completion.completedAt ?? null,
    };
  }

  const taskMetadata: FollowUpTaskStatePayload['taskMetadata'] = {};
  for (const metadata of doc.taskMetadata ?? []) {
    taskMetadata[metadata.taskId] = {
      ...metadata,
      dueAt: metadata.dueAt ?? null,
      supportingMetric: metadata.supportingMetric ?? undefined,
      statusWhenCreated: metadata.statusWhenCreated ?? undefined,
    };
  }

  return {
    completions,
    manualTasks: doc.manualTasks ?? [],
    shownTasks: doc.shownTasks ?? [],
    taskMetadata,
  };
};

export const buildCompletionEntries = (
  value: unknown,
  referralId: string
): FollowUpTaskCompletion[] => {
  if (!value || typeof value !== 'object') {
    return [];
  }
  return Object.entries(value as Record<string, unknown>)
    .filter(([taskId]) => taskId.startsWith(`${referralId}::`))
    .map(([taskId, payload]) => {
      const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
      return {
        taskId,
        completed: Boolean(record.completed),
        completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
      } satisfies FollowUpTaskCompletion;
    });
};

export const buildManualTaskEntries = (value: unknown): FollowUpManualTask[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Partial<FollowUpManualTask> & Record<string, unknown>;
      if (typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.message !== 'string') {
        return null;
      }
      if (!PRIORITIES.has(String(record.priority)) || !CATEGORIES.has(String(record.category))) {
        return null;
      }
      return {
        id: record.id,
        title: record.title,
        message: record.message,
        dueAt: typeof record.dueAt === 'string' ? record.dueAt : null,
        priority: record.priority as FollowUpManualTask['priority'],
        category: record.category as FollowUpManualTask['category'],
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
      } satisfies FollowUpManualTask;
    })
    .filter((item): item is FollowUpManualTask => Boolean(item));
};

export const buildShownTasks = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
};

export const buildTaskMetadataEntries = (
  value: unknown,
  referralId: string
): FollowUpTaskMetadata[] => {
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value as Record<string, unknown>)
    .filter(([taskId]) => taskId.startsWith(`${referralId}::`))
    .map(([taskId, payload]) => {
      if (!payload || typeof payload !== 'object') {
        return null;
      }
      const record = payload as Partial<FollowUpTaskMetadata> & Record<string, unknown>;
      if (typeof record.title !== 'string' || typeof record.message !== 'string') {
        return null;
      }
      if (!PRIORITIES.has(String(record.priority)) || !CATEGORIES.has(String(record.category))) {
        return null;
      }
      return {
        taskId,
        title: record.title,
        message: record.message,
        priority: record.priority as FollowUpTaskMetadata['priority'],
        category: record.category as FollowUpTaskMetadata['category'],
        dueAt: typeof record.dueAt === 'string' ? record.dueAt : null,
        supportingMetric: typeof record.supportingMetric === 'string' ? record.supportingMetric : undefined,
        isManual: Boolean(record.isManual),
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
        statusWhenCreated: typeof record.statusWhenCreated === 'string' ? record.statusWhenCreated : undefined,
      } satisfies FollowUpTaskMetadata;
    })
    .filter((item): item is FollowUpTaskMetadata => Boolean(item));
};
