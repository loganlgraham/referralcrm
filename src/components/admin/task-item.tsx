'use client';

import { useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import { CheckCircle2, Circle, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';

const SLA_TIME_ZONE = 'America/Denver';

export interface TaskItemData {
  _id: string;
  referralId: string;
  title: string;
  status: 'open' | 'completed' | 'dismissed';
  dueAt?: string;
  dueAtOverride?: string;
  snoozedUntil?: string;
  ruleKey?: string | null;
  effectiveDueAt: string | null;
}

function formatDueDate(value: string | null | undefined): string {
  if (!value) return 'No due date';
  try {
    return formatInTimeZone(new Date(value), SLA_TIME_ZONE, "MMM d, yyyy h:mm a 'MT'");
  } catch {
    return new Date(value).toLocaleString();
  }
}

interface TaskItemProps {
  task: TaskItemData;
  showAsCompleted?: boolean;
  onComplete: (taskId: string) => void | Promise<void>;
  onDismiss: (taskId: string) => void | Promise<void>;
  onSnooze: (taskId: string, until: Date) => void | Promise<void>;
  onUnsnooze: (taskId: string) => void | Promise<void>;
  onSetDueOverride: (taskId: string, overrideValue: string | null) => void | Promise<void>;
  expandedTaskId: string | null;
  onToggleExpand: (taskId: string) => void;
}

export function TaskItem({
  task,
  showAsCompleted = false,
  onComplete,
  onDismiss,
  onSnooze,
  onUnsnooze,
  onSetDueOverride,
  expandedTaskId,
  onToggleExpand,
}: TaskItemProps) {
  const [snoozeUntil, setSnoozeUntil] = useState('');
  const [dueOverride, setDueOverride] = useState('');
  const isExpanded = expandedTaskId === task._id;
  const isSnoozed = task.snoozedUntil && new Date(task.snoozedUntil) > new Date();

  const handleSnooze = () => {
    const until = snoozeUntil ? new Date(snoozeUntil) : null;
    if (!until || Number.isNaN(until.getTime())) {
      toast.error('Select a valid snooze date');
      return;
    }
    void onSnooze(task._id, until);
    setSnoozeUntil('');
    onToggleExpand(task._id);
  };

  const handleSetOverride = () => {
    void onSetDueOverride(task._id, dueOverride || null);
    setDueOverride('');
    onToggleExpand(task._id);
  };

  const handleClearOverride = () => {
    void onSetDueOverride(task._id, null);
    setDueOverride('');
    onToggleExpand(task._id);
  };

  return (
    <li className="flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      {!showAsCompleted ? (
        <button
          type="button"
          onClick={() => onComplete(task._id)}
          className="mt-0.5 shrink-0 text-slate-400 transition hover:text-brand"
          title="Complete"
        >
          <Circle className="h-5 w-5" />
        </button>
      ) : (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{task.title}</p>
        <p className="text-xs text-slate-500">
          {formatDueDate(task.effectiveDueAt ?? task.dueAt)}
          {isSnoozed && <span className="ml-1 text-amber-600">(snoozed)</span>}
        </p>
        {isExpanded && !showAsCompleted && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            {task.ruleKey && (
              <button
                type="button"
                onClick={() => onDismiss(task._id)}
                className="block text-xs font-semibold text-rose-600 hover:underline"
              >
                Dismiss
              </button>
            )}
            {isSnoozed ? (
              <button
                type="button"
                onClick={() => onUnsnooze(task._id)}
                className="block text-xs font-semibold text-slate-600 hover:underline"
              >
                Unsnooze
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={snoozeUntil}
                  onChange={(e) => setSnoozeUntil(e.target.value)}
                  className="rounded border border-slate-200 px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={handleSnooze}
                  className="text-xs font-semibold text-slate-600 hover:underline"
                >
                  Snooze
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={dueOverride}
                onChange={(e) => setDueOverride(e.target.value)}
                className="rounded border border-slate-200 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={handleClearOverride}
                className="text-xs font-semibold text-slate-600 hover:underline"
              >
                Clear override
              </button>
              {dueOverride && (
                <button
                  type="button"
                  onClick={handleSetOverride}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Set override
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {!showAsCompleted && (
        <button
          type="button"
          onClick={() => onToggleExpand(task._id)}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
