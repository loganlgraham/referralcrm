export interface ClosedTaskCandidate {
  referralId: string;
  title?: string | null;
  status: string;
  completedAt?: Date | string | null;
  dismissedAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

function timestamp(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Latest of completed, dismissed, and updated time. Open tasks are ignored. */
export function pickLatestClosedTaskTitles(
  tasks: readonly ClosedTaskCandidate[]
): Map<string, string | null> {
  const best = new Map<string, { at: number; title: string | null }>();

  for (const task of tasks) {
    if (task.status !== 'completed' && task.status !== 'dismissed') continue;
    if (!task.referralId) continue;

    const at = Math.max(
      timestamp(task.completedAt),
      timestamp(task.dismissedAt),
      timestamp(task.updatedAt)
    );
    const current = best.get(task.referralId);
    if (current && at <= current.at) continue;

    const trimmed = task.title?.trim();
    best.set(task.referralId, { at, title: trimmed ? task.title ?? null : null });
  }

  return new Map([...best].map(([referralId, row]) => [referralId, row.title]));
}
