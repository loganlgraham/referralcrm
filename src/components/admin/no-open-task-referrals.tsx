'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ClipboardCheck, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { getTodayEightAmMountainDateTimeLocal } from '@/lib/admin-task-day';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { TableSkeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status-pill';
import {
  Table,
  TableScroll,
  TableShell,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@/components/ui/table-shell';
import type { NoOpenTaskReferralEntry } from '@/app/api/admin/tasks/no-open-task-referrals/route';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

interface NoOpenTaskReferralsProps {
  /** Called after a task is created so the parent can refresh board data. */
  onTaskCreated?: () => void;
}

export function NoOpenTaskReferrals({ onTaskCreated }: NoOpenTaskReferralsProps) {
  const { data, isLoading, mutate } = useSWR<NoOpenTaskReferralEntry[]>(
    '/api/admin/tasks/no-open-task-referrals',
    fetcher
  );

  const [taskTarget, setTaskTarget] = useState<NoOpenTaskReferralEntry | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueAt, setTaskDueAt] = useState(() => getTodayEightAmMountainDateTimeLocal());
  const [isSaving, setIsSaving] = useState(false);

  const openTaskModal = (referral: NoOpenTaskReferralEntry) => {
    setTaskTarget(referral);
    setTaskTitle('');
    setTaskDueAt(getTodayEightAmMountainDateTimeLocal());
  };

  const closeTaskModal = () => {
    if (isSaving) return;
    setTaskTarget(null);
  };

  const handleCreateTask = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!taskTarget) return;

    const title = taskTitle.trim();
    if (!title) {
      toast.error('Add a task name before saving.');
      return;
    }
    if (!taskDueAt) {
      toast.error('Add a due date before saving.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          referralId: taskTarget.id,
          title,
          dueAt: new Date(taskDueAt).toISOString(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(`Task created for ${taskTarget.borrowerName}`);
      setTaskTarget(null);
      void mutate();
      onTaskCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading && !data) {
    return <TableSkeleton rows={8} columns={6} />;
  }

  const referrals = data ?? [];

  if (referrals.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheck className="h-5 w-5" />}
        title="Every active referral has an open task"
        description="Nothing is slipping through the cracks — all pipeline referrals have a follow-up scheduled."
      />
    );
  }

  return (
    <>
      <TableShell>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-surface-muted/60 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Referrals with no open tasks</h2>
            <p className="text-xs text-foreground-muted">
              Active pipeline referrals missing an open follow-up task
            </p>
          </div>
          <span className="text-xs font-medium text-foreground-muted">
            {referrals.length} referral{referrals.length === 1 ? '' : 's'}
          </span>
        </div>
        <TableScroll className="max-h-[34rem] overflow-y-auto">
          <Table>
            <THead>
              <tr>
                <Th>Borrower</Th>
                <Th>Status</Th>
                <Th>Agent</Th>
                <Th>MC</Th>
                <Th>Last activity</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {referrals.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link
                      prefetch={false}
                      href={`/referrals/${row.id}`}
                      className="font-medium text-primary transition hover:text-primary-hover hover:underline"
                    >
                      {row.borrowerName}
                    </Link>
                  </Td>
                  <Td>
                    <StatusPill kind="auto" status={row.status} />
                  </Td>
                  <Td className="text-foreground-muted">{row.agentName ?? '—'}</Td>
                  <Td className="text-foreground-muted">{row.mcName ?? '—'}</Td>
                  <Td className="text-foreground-muted">
                    {row.lastActivityAt
                      ? dateFormatter.format(new Date(row.lastActivityAt))
                      : '—'}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      leadingIcon={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => openTaskModal(row)}
                    >
                      Create task
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableScroll>
      </TableShell>

      <Modal
        isOpen={taskTarget !== null}
        onClose={closeTaskModal}
        size="sm"
        title="Create task"
        description={taskTarget ? `Schedule a follow-up for ${taskTarget.borrowerName}.` : undefined}
      >
        <form onSubmit={handleCreateTask} className="space-y-4 px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="no-task-title">Task name</Label>
            <Input
              id="no-task-title"
              type="text"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Call agent for a status update"
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="no-task-due">Due</Label>
            <Input
              id="no-task-due"
              type="datetime-local"
              value={taskDueAt}
              onChange={(e) => setTaskDueAt(e.target.value)}
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={closeTaskModal} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={isSaving}>
              Create task
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
