/**
 * Shapes and helpers shared by the referral list response and the referral
 * detail page. Kept free of mongoose and auth imports so both the server data
 * layer and client components can pull from it.
 */

export interface ReferralLastActivity {
  text: string;
  authorName: string;
  at: string;
}

export interface ReferralLatestDeal {
  status: string;
  stageLabel: string | null;
  closingDate: string | null;
}

export interface ReferralCounterparty {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface ReferralNoteLike {
  content?: string | null;
  authorName?: string | null;
  createdAt?: string | Date | null;
  hiddenFromAgent?: boolean | null;
  hiddenFromMc?: boolean | null;
}

const toDate = (value?: string | Date | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** Mirrors the note filter applied by `getReferralById`. */
export const isNoteVisibleTo = (note: ReferralNoteLike, viewerRole?: string | null): boolean => {
  if (viewerRole === 'agent' && note.hiddenFromAgent) {
    return false;
  }
  if (viewerRole === 'mc' && note.hiddenFromMc) {
    return false;
  }
  return true;
};

/**
 * Newest note this viewer is allowed to see. Notes hidden from the viewer are
 * skipped so last-activity copy matches what they can actually read.
 */
export const resolveLastActivity = (
  notes: ReferralNoteLike[] | undefined | null,
  viewerRole?: string | null
): ReferralLastActivity | null => {
  if (!Array.isArray(notes) || notes.length === 0) {
    return null;
  }

  let latest: ReferralLastActivity | null = null;
  let latestAt = -Infinity;

  for (const note of notes) {
    if (!isNoteVisibleTo(note, viewerRole)) {
      continue;
    }

    const createdAt = toDate(note.createdAt);
    const content = typeof note.content === 'string' ? note.content.trim() : '';

    if (!createdAt || content.length === 0) {
      continue;
    }

    const timestamp = createdAt.getTime();
    if (timestamp > latestAt) {
      latestAt = timestamp;
      latest = {
        text: content,
        authorName: typeof note.authorName === 'string' ? note.authorName : '',
        at: createdAt.toISOString(),
      };
    }
  }

  return latest;
};
