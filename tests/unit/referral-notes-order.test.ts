import { describe, expect, it } from '@jest/globals';
import { splitPinnedNotes } from '@/utils/referral-notes-order';

describe('splitPinnedNotes', () => {
  it('separates pinned notes and sorts each group newest first', () => {
    const notes = [
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-01-03T00:00:00.000Z', pinned: true, pinnedAt: '2026-02-01T00:00:00.000Z' },
      { id: 'c', createdAt: '2026-01-05T00:00:00.000Z' },
      { id: 'd', createdAt: '2026-01-02T00:00:00.000Z', pinned: true, pinnedAt: '2026-03-01T00:00:00.000Z' },
    ];

    const { pinnedNotes, unpinnedNotes } = splitPinnedNotes(notes);

    expect(pinnedNotes.map((note) => note.id)).toEqual(['d', 'b']);
    expect(unpinnedNotes.map((note) => note.id)).toEqual(['c', 'a']);
  });

  it('falls back to createdAt when a pinned note has no pinnedAt', () => {
    const notes = [
      { id: 'old', createdAt: '2026-01-01T00:00:00.000Z', pinned: true, pinnedAt: null },
      { id: 'new', createdAt: '2026-01-04T00:00:00.000Z', pinned: true },
    ];

    expect(splitPinnedNotes(notes).pinnedNotes.map((note) => note.id)).toEqual(['new', 'old']);
  });

  it('does not mutate the input array', () => {
    const notes = [
      { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    splitPinnedNotes(notes);
    expect(notes.map((note) => note.id)).toEqual(['a', 'b']);
  });
});
