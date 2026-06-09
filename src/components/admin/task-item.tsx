'use client';

import { useState } from 'react';
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { CheckCircle2, Circle, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner';

const SLA_TIME_ZONE = 'America/Denver';

function getSnoozeBaseDate(task: TaskItemData): Date {
  const now = new Date();
  const effective = task.effectiveDueAt ?? task.dueAt;
  if (effective) {
    const d = new Date(effective);
    // Overdue tasks snooze relative to now; otherwise a "+N days" preset
    // could land in the past and silently have no effect.
    if (!Number.isNaN(d.getTime()) && d > now) return d;
  }
  return now;
}

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
  onEdit?: (
    taskId: string,
    updates: {
      title?: string;
      dueAt?: string | null;
    }
  ) => void | Promise<void>;
  expandedTaskId: string | null;
  onToggleExpand: (taskId: string) => void;
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function TaskItem({
  task,
  showAsCompleted = false,
  onComplete,
  onDismiss,
  onSnooze,
  onUnsnooze,
  onSetDueOverride,
  onEdit,
  expandedTaskId,
  onToggleExpand,
}: TaskItemProps) {
  const [dueOverride, setDueOverride] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDueAt, setEditDueAt] = useState(toDateTimeLocalValue(task.dueAt));
  const isExpanded = expandedTaskId === task._id;
  const isSnoozed = task.snoozedUntil && new Date(task.snoozedUntil) > new Date();

  const handleSnoozePreset = (days: number) => {
    const base = getSnoozeBaseDate(task);
    const until = addDays(base, days);
    void onSnooze(task._id, until);
    onToggleExpand(task._id);
  };

  const handleSetReschedule = () => {
    if (!dueOverride) {
      toast.error('Select a date first');
      return;
    }
    const d = new Date(dueOverride);
    if (Number.isNaN(d.getTime())) {
      toast.error('Invalid date');
      return;
    }
    void onSetDueOverride(task._id, dueOverride);
    setDueOverride('');
    onToggleExpand(task._id);
  };

  const handleResetReschedule = () => {
    void onSetDueOverride(task._id, null);
    setDueOverride('');
    onToggleExpand(task._id);
  };

  const handleEditSave = async () => {
    if (!onEdit) return;
    const title = editTitle.trim();
    if (!title) {
      toast.error('Task name is required');
      return;
    }
    const dueAt = editDueAt ? new Date(editDueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      toast.error('Invalid due date');
      return;
    }

    await onEdit(task._id, {
      title,
      dueAt: dueAt ? dueAt.toISOString() : null,
    });
    setIsEditing(false);
    onToggleExpand(task._id);
  };

  return (
    <li className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/50 p-3">
      {!showAsCompleted ? (
        <button
          type="button"
          onClick={() => onComplete(task._id)}
          className="mt-0.5 shrink-0 text-foreground-subtle transition hover:text-primary-700"
          title="Complete"
        >
          <Circle className="h-5 w-5" />
        </button>
      ) : (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{task.title}</p>
        <p className="text-xs text-foreground-subtle">
          {formatDueDate(task.effectiveDueAt ?? task.dueAt)}
          {isSnoozed && <span className="ml-1 text-amber-600">(snoozed)</span>}
        </p>
        {isExpanded && !showAsCompleted && (
          <div className="mt-3 space-y-2 border-t border-border pt-3">
            {task.ruleKey && (
              <button
                type="button"
                onClick={() => onDismiss(task._id)}
                className="block text-xs font-semibold text-rose-600 hover:underline"
              >
                Dismiss
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={() =>
                  setIsEditing((prev) => {
                    if (!prev) {
                      setEditTitle(task.title);
                      setEditDueAt(toDateTimeLocalValue(task.dueAt));
                    }
                    return !prev;
                  })
                }
                className="block text-xs font-semibold text-foreground-muted hover:underline"
              >
                {isEditing ? 'Cancel edit' : 'Edit task'}
              </button>
            )}
            {isEditing && onEdit && (
              <div className="space-y-2 rounded-md border border-border bg-surface-raised p-2">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded border border-border px-2 py-1 text-xs"
                  placeholder="Task name"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    value={editDueAt}
                    onChange={(e) => setEditDueAt(e.target.value)}
                    className="rounded border border-border px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleEditSave}
                    className="rounded border border-border bg-surface-raised px-2 py-1 text-xs font-medium text-foreground-muted transition hover:bg-surface-muted"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
            {isSnoozed ? (
              <button
                type="button"
                onClick={() => onUnsnooze(task._id)}
                className="block text-xs font-semibold text-foreground-muted hover:underline"
              >
                Unsnooze
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-xs text-foreground-subtle">Snooze:</span>
                {([1, 3, 7, 30] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => handleSnoozePreset(days)}
                    className="rounded border border-border bg-surface-raised px-2 py-1 text-xs font-medium text-foreground-muted transition hover:bg-surface-muted"
                  >
                    +{days} day{days === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-foreground-subtle">Reschedule:</span>
              <input
                type="datetime-local"
                value={dueOverride}
                onChange={(e) => setDueOverride(e.target.value)}
                className="rounded border border-border px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={handleSetReschedule}
                disabled={!dueOverride}
                className="rounded border border-border bg-surface-raised px-2 py-1 text-xs font-medium text-foreground-muted transition hover:bg-surface-muted disabled:opacity-50"
              >
                Set
              </button>
              {task.dueAtOverride && (
                <button
                  type="button"
                  onClick={handleResetReschedule}
                  className="text-xs font-semibold text-foreground-muted hover:underline"
                >
                  Reset to original
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
          className="shrink-0 rounded p-1 text-foreground-subtle hover:bg-surface-subtle hover:text-foreground-muted"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}
