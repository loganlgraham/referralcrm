'use client';

import { FormEvent, useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import { getEightAmMountainDateTimeLocalForDay, getTodayEightAmMountainDateTimeLocal } from '@/lib/admin-task-day';
import { TaskItem, type TaskItemData } from '@/components/admin/task-item';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface AdminTask {
  _id: string;
  referralId: string;
  title: string;
  description?: string;
  category?: string;
  priority?: string;
  status: 'open' | 'completed' | 'dismissed';
  dueAt?: string;
  dueAtOverride?: string;
  snoozedUntil?: string;
  ruleKey?: string | null;
  cycleKey: string;
  effectiveDueAt?: string | null;
  createdAt: string;
  createdBy: string;
}

interface AdminTasksCardProps {
  referralId: string;
  viewerRole: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const CALENDAR_WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const nestedPanelClasses = 'rounded-lg border border-border bg-surface-muted p-3';

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function toDayKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function parseDayKey(dayKey: string): Date | null {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatSelectedDay(dayKey: string): string {
  const parsed = parseDayKey(dayKey);
  if (!parsed) return dayKey;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function shiftMonth(value: Date, amount: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

function getDefaultDueAtForDay(dayKey: string): string {
  return getEightAmMountainDateTimeLocalForDay(dayKey);
}

function getDueBucket(effectiveDue: string | null | undefined): number {
  if (!effectiveDue) return 4;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(effectiveDue);
  const dueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = dueDate.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return 0;
  if (diffDays === 0) return 1;
  if (diffDays <= 7) return 2;
  return 3;
}

export function AdminTasksCard({ referralId, viewerRole }: AdminTasksCardProps) {
  const isAdmin = viewerRole === 'admin';

  const [statusFilter, setStatusFilter] = useState<'open' | 'completed'>('open');
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDueAt, setManualDueAt] = useState(() => getTodayEightAmMountainDateTimeLocal());
  const [showDayManualForm, setShowDayManualForm] = useState(false);
  const [dayManualTitle, setDayManualTitle] = useState('');
  const [dayManualDueAt, setDayManualDueAt] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()));

  const tasksUrl = `/api/admin/tasks?referralId=${referralId}&status=${statusFilter}`;
  const { data: tasks = [], mutate } = useSWR<AdminTask[]>(isAdmin ? tasksUrl : null, fetcher);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => {
      const bucketA = getDueBucket(a.effectiveDueAt);
      const bucketB = getDueBucket(b.effectiveDueAt);
      if (bucketA !== bucketB) return bucketA - bucketB;
      const dateA = a.effectiveDueAt ? new Date(a.effectiveDueAt).getTime() : Infinity;
      const dateB = b.effectiveDueAt ? new Date(b.effectiveDueAt).getTime() : Infinity;
      return dateA - dateB;
    });
  }, [tasks]);

  const { overdueAndToday, upcoming } = useMemo(() => {
    const overdueAndToday: AdminTask[] = [];
    const upcoming: AdminTask[] = [];
    for (const task of sortedTasks) {
      const bucket = getDueBucket(task.effectiveDueAt);
      if (bucket === 0 || bucket === 1) {
        overdueAndToday.push(task);
      } else {
        upcoming.push(task);
      }
    }
    return { overdueAndToday, upcoming };
  }, [sortedTasks]);

  const tasksByDay = useMemo(() => {
    const byDay = new Map<string, AdminTask[]>();
    for (const task of sortedTasks) {
      const dateValue = task.effectiveDueAt ?? task.dueAt;
      if (!dateValue) continue;
      const dayKey = toDayKey(dateValue);
      const existing = byDay.get(dayKey);
      if (existing) {
        existing.push(task);
      } else {
        byDay.set(dayKey, [task]);
      }
    }
    return byDay;
  }, [sortedTasks]);

  const calendarCells = useMemo(() => {
    const firstDay = startOfMonth(calendarMonth);
    const year = firstDay.getFullYear();
    const month = firstDay.getMonth();
    const firstWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

    return Array.from({ length: totalCells }, (_, idx) => {
      const dayNumber = idx - firstWeekday + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        return { dayKey: null, label: null };
      }

      const dayKey = `${year}-${padNumber(month + 1)}-${padNumber(dayNumber)}`;
      return { dayKey, label: dayNumber };
    });
  }, [calendarMonth]);

  const selectedDayTasks = useMemo(() => {
    if (!selectedDay) return [];
    return tasksByDay.get(selectedDay) ?? [];
  }, [selectedDay, tasksByDay]);

  const handleComplete = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task completed');
      void mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete task');
    }
  };

  const handleDismiss = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task dismissed');
      void mutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dismiss task');
    }
  };

  const handleSnooze = async (taskId: string, until: Date) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snooze', snoozedUntil: until.toISOString() }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task snoozed');
      void mutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to snooze task');
    }
  };

  const handleUnsnooze = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unsnooze' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Snooze cleared');
      void mutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to unsnooze task');
    }
  };

  const handleSetDueOverride = async (taskId: string, overrideValue: string | null) => {
    const override = overrideValue ? new Date(overrideValue) : null;
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_due_override',
          dueAtOverride: override && !Number.isNaN(override.getTime()) ? override.toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(override ? 'Due date updated' : 'Due date override cleared');
      void mutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update due date');
    }
  };

  const handleEdit = async (
    taskId: string,
    updates: {
      title?: string;
      dueAt?: string | null;
    }
  ) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          ...updates,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task updated');
      void mutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const handleToggleExpand = (taskId: string) => {
    setExpandedTaskId((prev) => (prev === taskId ? null : taskId));
  };

  const createManualTask = async (titleValue: string, dueAtValue: string): Promise<boolean> => {
    const title = titleValue.trim();
    if (!title) {
      toast.error('Add a task name before saving.');
      return false;
    }
    if (!dueAtValue) {
      toast.error('Add a due date before saving.');
      return false;
    }

    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralId,
          title,
          dueAt: new Date(dueAtValue).toISOString(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task created');
      void mutate();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create task');
      return false;
    }
  };

  const handleManualSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const created = await createManualTask(manualTitle, manualDueAt);
    if (!created) return;
    setManualTitle('');
    setManualDueAt(getTodayEightAmMountainDateTimeLocal());
    setShowManualForm(false);
  };

  const handleDayManualSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const created = await createManualTask(dayManualTitle, dayManualDueAt);
    if (!created) return;
    setDayManualTitle('');
    if (selectedDay) {
      setDayManualDueAt(getDefaultDueAtForDay(selectedDay));
    }
    setShowDayManualForm(false);
  };

  const handleCalendarDaySelect = (dayKey: string) => {
    setSelectedDay(dayKey);
    setShowDayManualForm(false);
    setDayManualTitle('');
    setDayManualDueAt(getDefaultDueAtForDay(dayKey));
  };

  const handleClearSelectedDay = () => {
    setSelectedDay(null);
    setShowDayManualForm(false);
    setDayManualTitle('');
    setDayManualDueAt('');
  };

  const renderTaskItem = (task: AdminTask, showAsCompleted: boolean) => (
    <TaskItem
      key={task._id}
      task={task as TaskItemData}
      showAsCompleted={showAsCompleted}
      onComplete={handleComplete}
      onDismiss={handleDismiss}
      onSnooze={handleSnooze}
      onUnsnooze={handleUnsnooze}
      onSetDueOverride={handleSetDueOverride}
      onEdit={handleEdit}
      expandedTaskId={showAsCompleted ? null : expandedTaskId}
      onToggleExpand={showAsCompleted ? () => {} : handleToggleExpand}
    />
  );

  if (!isAdmin) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle>Tasks</CardTitle>
          <p className="text-sm text-foreground-muted">Admin tasks for this referral.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setStatusFilter(statusFilter === 'open' ? 'completed' : 'open')}
          >
            {statusFilter === 'open' ? 'Show completed' : 'Show open'}
          </Button>
          {statusFilter === 'open' && (
            <Button
              size="sm"
              leadingIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={() => setShowManualForm(!showManualForm)}
            >
              Add task
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
      {showManualForm && (
        <form onSubmit={handleManualSubmit} className={cn('space-y-2', nestedPanelClasses)}>
          <Input
            type="text"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            placeholder="Task name"
            required
          />
          <Input
            type="datetime-local"
            value={manualDueAt}
            onChange={(e) => setManualDueAt(e.target.value)}
            className="tabular-nums"
            required
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              Create
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowManualForm(false);
                setManualTitle('');
                setManualDueAt(getTodayEightAmMountainDateTimeLocal());
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="space-y-6">
        <div>
          {selectedDay ? (
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{formatSelectedDay(selectedDay)}</p>
              <div className="flex items-center gap-1">
                <p className="text-xs text-foreground-subtle">
                  <span className="tabular-nums">{selectedDayTasks.length}</span> task
                  {selectedDayTasks.length === 1 ? '' : 's'}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleClearSelectedDay}
                  aria-label="Clear day filter"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}

          <ul className="space-y-2">
            {selectedDay ? (
              selectedDayTasks.length === 0 ? (
                <li className="py-4 text-center text-sm text-foreground-subtle">No tasks due on this day.</li>
              ) : (
                selectedDayTasks.map((task) => renderTaskItem(task, statusFilter === 'completed'))
              )
            ) : statusFilter === 'open' ? (
              overdueAndToday.length === 0 && upcoming.length === 0 ? (
                <li className="py-4 text-center text-sm text-foreground-subtle">No open tasks</li>
              ) : (
                <>
                  {overdueAndToday.map((task) => renderTaskItem(task, false))}
                  {upcoming.length > 0 && (
                    <li className="pt-2">
                      <button
                        type="button"
                        onClick={() => setShowUpcoming(!showUpcoming)}
                        className="flex items-center gap-1 text-sm font-semibold text-foreground-muted hover:text-foreground"
                      >
                        {showUpcoming ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        Upcoming tasks ({upcoming.length})
                      </button>
                      {showUpcoming && (
                        <ul className="mt-2 space-y-2">
                          {upcoming.map((task) => renderTaskItem(task, false))}
                        </ul>
                      )}
                    </li>
                  )}
                </>
              )
            ) : sortedTasks.length === 0 ? (
              <li className="py-4 text-center text-sm text-foreground-subtle">No completed tasks</li>
            ) : (
              sortedTasks.map((task) => renderTaskItem(task, true))
            )}
          </ul>

          {selectedDay && statusFilter === 'open' ? (
            <div className="mt-3 space-y-2">
              {!showDayManualForm ? (
                <Button
                  size="sm"
                  leadingIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setShowDayManualForm(true);
                    if (!dayManualDueAt && selectedDay) {
                      setDayManualDueAt(getDefaultDueAtForDay(selectedDay));
                    }
                  }}
                >
                  Add task for this day
                </Button>
              ) : (
                <form
                  onSubmit={handleDayManualSubmit}
                  className={cn('space-y-2', nestedPanelClasses)}
                >
                  <Input
                    type="text"
                    value={dayManualTitle}
                    onChange={(e) => setDayManualTitle(e.target.value)}
                    placeholder="Task name"
                    className="h-8"
                    required
                  />
                  <Input
                    type="datetime-local"
                    value={dayManualDueAt}
                    onChange={(e) => setDayManualDueAt(e.target.value)}
                    className="h-8 tabular-nums"
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      Create
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setShowDayManualForm(false);
                        setDayManualTitle('');
                        if (selectedDay) {
                          setDayManualDueAt(getDefaultDueAtForDay(selectedDay));
                        }
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : null}
        </div>

        <div className="space-y-3 border-t border-border pt-5">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <CalendarDays className="h-4 w-4 text-foreground-subtle" />
              Calendar
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCalendarMonth((prev) => shiftMonth(prev, -1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <p className="min-w-[8rem] text-center text-xs font-medium tabular-nums text-foreground-muted">
                {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </p>
              <Button
                variant="secondary"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCalendarMonth((prev) => shiftMonth(prev, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-foreground-subtle">
            {CALENDAR_WEEK_DAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell, idx) => {
              if (!cell.dayKey || !cell.label) {
                return <div key={`empty-${idx}`} className="h-10 rounded-lg bg-surface-muted/40" aria-hidden />;
              }
              const dayKey = cell.dayKey;
              const hasTasks = tasksByDay.has(dayKey);
              const isSelected = selectedDay === dayKey;

              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => handleCalendarDaySelect(dayKey)}
                  className={`relative h-10 rounded-lg border text-sm tabular-nums transition ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : hasTasks
                        ? 'border-border-strong bg-surface-muted text-foreground hover:bg-surface-subtle'
                        : 'border-border text-foreground-subtle hover:bg-surface-muted'
                  }`}
                >
                  {cell.label}
                  {hasTasks && (
                    <span className="absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}
