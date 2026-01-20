'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  FOLLOW_UP_TASK_STORAGE_KEY,
  createDefaultTaskState,
  parseFollowUpTaskState,
} from '@/components/referrals/follow-up-task-provider';

function CompleteFollowUpTasksContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'pending' | 'updated' | 'noop'>('pending');

  const taskIds = useMemo(() => searchParams.getAll('taskId').filter(Boolean), [searchParams]);
  const returnTo = searchParams.get('returnTo') || '/referrals/follow-ups';

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (taskIds.length === 0) {
      setStatus('noop');
      return;
    }

    const markTasksComplete = async () => {
      try {
        const response = await fetch('/api/follow-up/tasks/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds }),
        });

        if (!response.ok) {
          throw new Error('Failed to update follow-up tasks');
        }

        const data = (await response.json()) as { updated?: number };

        const raw = window.localStorage.getItem(FOLLOW_UP_TASK_STORAGE_KEY);
        const state = parseFollowUpTaskState(raw) ?? createDefaultTaskState();
        let locallyUpdated = false;

        taskIds.forEach((taskId) => {
          if (!taskId) return;
          const existing = state.completions[taskId];
          if (!existing?.completed) {
            state.completions[taskId] = { completed: true, completedAt: new Date().toISOString() };
            locallyUpdated = true;
          }
        });

        if (locallyUpdated) {
          const serialized = JSON.stringify(state);
          window.localStorage.setItem(FOLLOW_UP_TASK_STORAGE_KEY, serialized);
        }

        setStatus(data.updated || locallyUpdated ? 'updated' : 'noop');
      } catch (error) {
        setStatus('noop');
      }
    };

    void markTasksComplete();
  }, [taskIds]);

  const headline = (() => {
    if (status === 'updated') return 'Tasks marked complete';
    if (status === 'noop' && taskIds.length === 0) return 'No tasks to update';
    if (status === 'noop') return 'Tasks already completed';
    return 'Updating your tasks...';
  })();

  const bodyCopy = (() => {
    if (status === 'updated') {
      return 'Nice work! The linked tasks are now marked complete and will stay in sync when you open the dashboard.';
    }
    if (status === 'noop' && taskIds.length === 0) {
      return 'We could not find any tasks to complete from this link. Double-check the email link and try again.';
    }
    if (status === 'noop') {
      return 'These tasks were already marked complete.';
    }
    return 'Finishing up…';
  })();

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-lg ring-1 ring-slate-200">
        <div className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">Follow-up tasks</p>
          <h1 className="text-2xl font-semibold text-slate-900">{headline}</h1>
          <p className="text-sm text-slate-600">{bodyCopy}</p>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={returnTo}
            className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-dark"
          >
            Go to the follow-up board
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function CompleteFollowUpTasksPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-700">Loading task completion…</div>}>
      <CompleteFollowUpTasksContent />
    </Suspense>
  );
}
