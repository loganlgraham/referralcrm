'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';

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
    <div className="space-y-4 rounded-card border border-border bg-surface-raised p-4 shadow-card">
      <div>
        <h2 className="text-eyebrow text-foreground-subtle">Admin notes</h2>
        <p className="mt-1.5 text-sm text-foreground-subtle">{description}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          placeholder="Record context for internal use"
          disabled={saving}
        />
        <Button type="submit" size="sm" disabled={!content.trim()} loading={saving}>
          {saving ? 'Saving…' : 'Save note'}
        </Button>
      </form>
      <div className="space-y-3">
        {sortedNotes.length === 0 && <EmptyState compact title="No notes yet" />}
        {sortedNotes.map((note) => (
          <div key={note.id} className="rounded-card border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground-subtle">
              <span className="font-semibold text-foreground-muted">
                {note.authorName} · {note.authorRole}
              </span>
              <span className="text-numeric">{formatTimestamp(note.createdAt)}</span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-foreground-muted">{note.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
