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

type FollowUpTaskStateLike = {
  referralId?: string;
  completions?: unknown;
  manualTasks?: unknown;
  shownTasks?: unknown;
  taskMetadata?: unknown;
};

function normalizeTaskId(taskId: string, referralId: string | undefined): string {
  if (!referralId) return taskId;
  const prefix = `${referralId}::`;
  return taskId.startsWith(prefix) ? taskId : `${prefix}${taskId}`;
}

export const buildStateFromDocument = (doc: FollowUpTaskStateLike | null): FollowUpTaskStatePayload => {
  if (!doc || typeof doc !== 'object') {
    return { completions: {}, manualTasks: [], shownTasks: [], taskMetadata: {} };
  }

  const referralId = typeof doc.referralId === 'string' ? doc.referralId : undefined;
  const completions: FollowUpTaskStatePayload['completions'] = {};
  const completionEntries = Array.isArray(doc.completions) ? doc.completions : [];
  for (const completion of completionEntries) {
    if (!completion || typeof completion !== 'object') {
      continue;
    }
    const record = completion as Partial<FollowUpTaskCompletion>;
    if (typeof record.taskId !== 'string') {
      continue;
    }
    const key = normalizeTaskId(record.taskId, referralId);
    completions[key] = {
      completed: Boolean(record.completed),
      completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
    };
  }

  const taskMetadata: FollowUpTaskStatePayload['taskMetadata'] = {};
  const metadataEntries = Array.isArray(doc.taskMetadata) ? doc.taskMetadata : [];
  for (const metadata of metadataEntries) {
    if (!metadata || typeof metadata !== 'object') {
      continue;
    }
    const record = metadata as Partial<FollowUpTaskMetadata>;
    if (typeof record.taskId !== 'string') {
      continue;
    }
    const key = normalizeTaskId(record.taskId, referralId);
    taskMetadata[key] = {
      taskId: key,
      title: record.title ?? '',
      message: record.message ?? '',
      priority: record.priority as FollowUpTaskMetadata['priority'],
      category: record.category as FollowUpTaskMetadata['category'],
      dueAt: record.dueAt ?? null,
      supportingMetric: record.supportingMetric ?? undefined,
      isManual: Boolean(record.isManual),
      createdAt: record.createdAt ?? new Date().toISOString(),
      statusWhenCreated: record.statusWhenCreated ?? undefined,
    };
  }

  return {
    completions,
    manualTasks: Array.isArray(doc.manualTasks) ? doc.manualTasks : [],
    shownTasks: Array.isArray(doc.shownTasks) ? doc.shownTasks : [],
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
  const tasks: FollowUpManualTask[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Partial<FollowUpManualTask> & Record<string, unknown>;
    if (typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.message !== 'string') {
      continue;
    }
    if (!PRIORITIES.has(String(record.priority)) || !CATEGORIES.has(String(record.category))) {
      continue;
    }
    tasks.push({
      id: record.id,
      title: record.title,
      message: record.message,
      dueAt: typeof record.dueAt === 'string' ? record.dueAt : null,
      priority: record.priority as FollowUpManualTask['priority'],
      category: record.category as FollowUpManualTask['category'],
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    });
  }
  return tasks;
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

  const mapped = Object.entries(value as Record<string, unknown>)
    .filter(([taskId]) => taskId.startsWith(`${referralId}::`))
    .map(([taskId, payload]): FollowUpTaskMetadata | null => {
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
    });

  return mapped.filter((item): item is FollowUpTaskMetadata => item !== null);
};
