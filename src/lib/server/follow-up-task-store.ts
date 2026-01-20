export interface StoredTaskCompletion {
  completed: boolean;
  completedAt: string;
}

const sharedTaskCompletions = new Map<string, StoredTaskCompletion>();

export function markFollowUpTaskCompletions(taskIds: string[]): number {
  const now = new Date().toISOString();
  let updated = 0;

  taskIds.forEach((taskId) => {
    if (!taskId) return;
    const existing = sharedTaskCompletions.get(taskId);
    if (!existing?.completed) {
      sharedTaskCompletions.set(taskId, { completed: true, completedAt: now });
      updated += 1;
    }
  });

  return updated;
}

export function getFollowUpTaskCompletion(taskId: string): StoredTaskCompletion | undefined {
  return sharedTaskCompletions.get(taskId);
}
