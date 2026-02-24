'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { TaskItem, type TaskItemData } from './task-item';
import type { ReferralTaskCard as ReferralTaskCardType } from '@/app/api/admin/tasks/board/route';

const GMAIL_COMPOSE_BASE = 'https://mail.google.com/mail/?view=cm&to=';

interface ReferralTaskCardProps {
  card: ReferralTaskCardType;
  view?: 'urgent' | 'upcoming';
  onMutate: () => void;
}

export function ReferralTaskCard({ card, view = 'urgent', onMutate }: ReferralTaskCardProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addDueAt, setAddDueAt] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [showCollapsedPrimary, setShowCollapsedPrimary] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const handleComplete = async (taskId: string) => {
    try {
      const res = await fetch(`/api/admin/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task completed');
      onMutate();
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
      onMutate();
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
      onMutate();
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
      onMutate();
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
      onMutate();
      setExpandedTaskId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update due date');
    }
  };

  const handleAddTaskSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title = addTitle.trim();
    if (!title) {
      toast.error('Add a task name before saving.');
      return;
    }
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralId: card.referralId,
          title,
          dueAt: addDueAt ? new Date(addDueAt).toISOString() : undefined,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success('Task created');
      onMutate();
      setAddTitle('');
      setAddDueAt('');
      setShowAddForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  const renderTask = (task: TaskItemData, showAsCompleted: boolean) => (
    <TaskItem
      key={task._id}
      task={task}
      showAsCompleted={showAsCompleted}
      onComplete={handleComplete}
      onDismiss={handleDismiss}
      onSnooze={handleSnooze}
      onUnsnooze={handleUnsnooze}
      onSetDueOverride={handleSetDueOverride}
      expandedTaskId={expandedTaskId}
      onToggleExpand={(id) => setExpandedTaskId((prev) => (prev === id ? null : id))}
    />
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href={`/referrals/${card.referralId}`}
              className="font-semibold text-slate-900 hover:text-brand hover:underline"
            >
              {card.borrower.name || 'Unnamed'}
            </Link>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {card.status}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
            {card.borrower.email && (
              <a
                href={`${GMAIL_COMPOSE_BASE}${encodeURIComponent(card.borrower.email)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                {card.borrower.email}
              </a>
            )}
            {card.borrower.phone && (
              <a href={`tel:${card.borrower.phone}`} className="text-brand hover:underline">
                {card.borrower.phone}
              </a>
            )}
          </div>
          {card.agent && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
              {card.agent.id ? (
                <Link
                  href={`/agents/${card.agent.id}`}
                  className="font-medium text-slate-700 hover:text-brand hover:underline"
                >
                  {card.agent.name ?? 'Agent'}
                </Link>
              ) : (
                <span>{card.agent.name ?? 'Unassigned'}</span>
              )}
              {card.agent.email && (
                <a
                  href={`${GMAIL_COMPOSE_BASE}${encodeURIComponent(card.agent.email)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  {card.agent.email}
                </a>
              )}
              {card.agent.phone && (
                <a href={`tel:${card.agent.phone}`} className="text-brand hover:underline">
                  {card.agent.phone}
                </a>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-dark"
        >
          <Plus className="h-3.5 w-3.5" /> Add task
        </button>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAddTaskSubmit}
          className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <input
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="Task name"
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
            required
          />
          <input
            type="datetime-local"
            value={addDueAt}
            onChange={(e) => setAddDueAt(e.target.value)}
            className="w-full rounded border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setAddTitle('');
                setAddDueAt('');
              }}
              className="rounded border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {view === 'upcoming' ? (
        <>
          <ul className="space-y-2">
            {card.upcomingTasks.map((task) => renderTask(task, false))}
          </ul>

          {(card.overdueTasks.length > 0 || card.todayTasks.length > 0 || card.completedTasks.length > 0) && (
            <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
              {(card.overdueTasks.length > 0 || card.todayTasks.length > 0) && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowCollapsedPrimary(!showCollapsedPrimary)}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
                  >
                    {showCollapsedPrimary ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Overdue / today tasks ({card.overdueTasks.length + card.todayTasks.length})
                  </button>
                  {showCollapsedPrimary && (
                    <ul className="mt-2 space-y-2">
                      {card.overdueTasks.map((task) => renderTask(task, false))}
                      {card.todayTasks.map((task) => renderTask(task, false))}
                    </ul>
                  )}
                </div>
              )}
              {card.completedTasks.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowCompleted(!showCompleted)}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
                  >
                    {showCompleted ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Completed tasks ({card.completedTasks.length})
                  </button>
                  {showCompleted && (
                    <ul className="mt-2 space-y-2">
                      {card.completedTasks.map((task) => renderTask(task, true))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <ul className="space-y-2">
            {card.overdueTasks.map((task) => renderTask(task, false))}
            {card.todayTasks.map((task) => renderTask(task, false))}
          </ul>

          {(card.upcomingTasks.length > 0 || card.completedTasks.length > 0) && (
            <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
              {card.upcomingTasks.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowCollapsedPrimary(!showCollapsedPrimary)}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
                  >
                    {showCollapsedPrimary ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Upcoming tasks ({card.upcomingTasks.length})
                  </button>
                  {showCollapsedPrimary && (
                    <ul className="mt-2 space-y-2">
                      {card.upcomingTasks.map((task) => renderTask(task, false))}
                    </ul>
                  )}
                </div>
              )}
              {card.completedTasks.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowCompleted(!showCompleted)}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-700 hover:text-slate-900"
                  >
                    {showCompleted ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    Completed tasks ({card.completedTasks.length})
                  </button>
                  {showCompleted && (
                    <ul className="mt-2 space-y-2">
                      {card.completedTasks.map((task) => renderTask(task, true))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
