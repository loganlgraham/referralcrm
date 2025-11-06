'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

interface PersonNote {
  id: string;
  authorName: string;
  authorRole: string;
  content: string;
  createdAt: string;
}

interface PersonNotesProps {
  subjectId: string;
  initialNotes: PersonNote[];
  endpoint: string;
  description: string;
}

const formatTimestamp = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

export function PersonNotes({ subjectId, initialNotes, endpoint, description }: PersonNotesProps) {
  const [notes, setNotes] = useState<PersonNote[]>(() => [...initialNotes]);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const sortedNotes = useMemo(
    () =>
      [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notes]
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim()) {
      toast.error('Add a note before saving');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`${endpoint}/${subjectId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.trim() })
      });
      if (!response.ok) {
        throw new Error('Unable to save note');
      }
      const created = (await response.json()) as PersonNote;
      setNotes((previous) => [
        {
          ...created,
          createdAt:
            typeof created.createdAt === 'string'
              ? created.createdAt
              : new Date(created.createdAt).toISOString()
        },
        ...previous
      ]);
      setContent('');
      toast.success('Note added');
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Admin Notes</h2>
        <p className="text-sm text-slate-500">{description}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          className="w-full rounded border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-brand focus:outline-none"
          placeholder="Record context for internal use"
          disabled={saving}
        />
        <button
          type="submit"
          disabled={saving || !content.trim()}
          className="inline-flex items-center rounded bg-brand px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
      </form>
      <div className="space-y-3">
        {sortedNotes.length === 0 && <p className="text-sm text-slate-500">No notes yet.</p>}
        {sortedNotes.map((note) => (
          <div key={note.id} className="rounded border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">
                {note.authorName} · {note.authorRole}
              </span>
              <span>{formatTimestamp(note.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{note.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
