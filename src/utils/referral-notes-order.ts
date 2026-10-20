export interface OrderableReferralNote {
  createdAt: string;
  pinned?: boolean;
  pinnedAt?: string | null;
}

const toTime = (value: string | null | undefined): number => {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export function splitPinnedNotes<T extends OrderableReferralNote>(
  notes: readonly T[]
): { pinnedNotes: T[]; unpinnedNotes: T[] } {
  const pinnedNotes: T[] = [];
  const unpinnedNotes: T[] = [];

  for (const note of notes) {
    if (note.pinned) {
      pinnedNotes.push(note);
    } else {
      unpinnedNotes.push(note);
    }
  }

  pinnedNotes.sort(
    (a, b) => toTime(b.pinnedAt ?? b.createdAt) - toTime(a.pinnedAt ?? a.createdAt)
  );
  unpinnedNotes.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));

  return { pinnedNotes, unpinnedNotes };
}
