import { useCallback, useEffect, useMemo, useState } from 'react';

export interface FollowUpTask {
  audience: 'Agent' | 'MC' | 'Referral';
  title: string;
  summary: string;
  suggestedChannel: 'Phone' | 'Email' | 'Text' | 'Internal';
  urgency: 'Low' | 'Medium' | 'High';
}

interface CompletedTaskEntry {
  id: string;
  completedAt: string;
  task: FollowUpTask;
}

function getStorageKey(referralId: string) {
  return `admin-followups:${referralId}`;
}

export function getFollowUpTaskId(task: FollowUpTask) {
  return `${task.audience}|${task.title}|${task.summary}|${task.suggestedChannel}|${task.urgency}`;
}

export function useFollowUpCompletion(referralId: string, tasks: FollowUpTask[]) {
  const [completed, setCompleted] = useState<Record<string, CompletedTaskEntry>>({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const stored = window.localStorage.getItem(getStorageKey(referralId));
      if (!stored) {
        setCompleted({});
        return;
      }
      const parsed = JSON.parse(stored) as Record<string, CompletedTaskEntry> | null;
      if (parsed && typeof parsed === 'object') {
        setCompleted(parsed);
      } else {
        setCompleted({});
      }
    } catch (error) {
      console.error('Failed to load follow-up completions', error);
      setCompleted({});
    }
  }, [referralId]);

  useEffect(() => {
    if (!tasks || tasks.length === 0) {
      setCompleted((previous) => (Object.keys(previous).length === 0 ? previous : {}));
      return;
    }
    setCompleted((previous) => {
      const validIds = new Set(tasks.map((task) => getFollowUpTaskId(task)));
      const nextEntries: Record<string, CompletedTaskEntry> = {};
      for (const id of Object.keys(previous)) {
        if (validIds.has(id)) {
          nextEntries[id] = previous[id];
        }
      }
      return Object.keys(nextEntries).length === Object.keys(previous).length ? previous : nextEntries;
    });
  }, [tasks]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(getStorageKey(referralId), JSON.stringify(completed));
    } catch (error) {
      console.error('Failed to persist follow-up completions', error);
    }
  }, [completed, referralId]);

  const markComplete = useCallback((task: FollowUpTask) => {
    const id = getFollowUpTaskId(task);
    setCompleted((previous) => {
      if (previous[id]) {
        return previous;
      }
      return {
        ...previous,
        [id]: {
          id,
          completedAt: new Date().toISOString(),
          task,
        },
      };
    });
  }, []);

  const undoComplete = useCallback((task: FollowUpTask) => {
    const id = getFollowUpTaskId(task);
    setCompleted((previous) => {
      if (!previous[id]) {
        return previous;
      }
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }, []);

  const activeTasks = useMemo(() => {
    const completedIds = new Set(Object.keys(completed));
    return tasks.filter((task) => !completedIds.has(getFollowUpTaskId(task)));
  }, [completed, tasks]);

  const completedTasks = useMemo(() => {
    return tasks.filter((task) => completed[getFollowUpTaskId(task)]);
  }, [completed, tasks]);

  const completionMeta = useMemo(() => {
    const meta = new Map<string, string>();
    for (const entry of Object.values(completed)) {
      meta.set(entry.id, entry.completedAt);
    }
    return meta;
  }, [completed]);

  return {
    activeTasks,
    completedTasks,
    completionMeta,
    markComplete,
    undoComplete,
  } as const;
}
