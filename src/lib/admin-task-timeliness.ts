export interface AdminTaskTimingFields {
  completedAt?: Date;
  dismissedAt?: Date;
  dueAt?: Date;
  dueAtOverride?: Date;
  snoozedUntil?: Date;
}

export function getEffectiveDueDate(
  task: Pick<AdminTaskTimingFields, 'dueAt' | 'dueAtOverride' | 'snoozedUntil'>,
  referenceDate: Date = new Date()
): Date | null {
  if (task.snoozedUntil && task.snoozedUntil > referenceDate) {
    return task.snoozedUntil;
  }
  if (task.dueAtOverride) {
    return task.dueAtOverride;
  }
  return task.dueAt ?? null;
}

export function getTaskResolvedAt(
  task: Pick<AdminTaskTimingFields, 'completedAt' | 'dismissedAt'>
): Date | null {
  return task.completedAt ?? task.dismissedAt ?? null;
}

export function wasTaskResolvedOnOrBeforeDueDate(task: AdminTaskTimingFields): boolean | null {
  const resolvedAt = getTaskResolvedAt(task);
  if (!resolvedAt) {
    return null;
  }

  const effectiveDueDate = getEffectiveDueDate(task, resolvedAt);
  if (!effectiveDueDate) {
    return null;
  }

  const dueDateEnd = new Date(
    effectiveDueDate.getFullYear(),
    effectiveDueDate.getMonth(),
    effectiveDueDate.getDate(),
    23,
    59,
    59,
    999
  );

  return resolvedAt.getTime() <= dueDateEnd.getTime();
}
