'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface AgentNpsEditorProps {
  agentId: string;
  initialScore: number | null;
}

export function AgentNpsEditor({ agentId, initialScore }: AgentNpsEditorProps) {
  const [savedScore, setSavedScore] = useState(initialScore);
  const [value, setValue] = useState(initialScore != null ? String(initialScore) : '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setSavedScore(initialScore);
    setValue(initialScore != null ? String(initialScore) : '');
  }, [initialScore]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) {
      return;
    }

    const trimmed = value.trim();
    let parsed: number | null = null;
    if (trimmed.length > 0) {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric) || numeric < -100 || numeric > 100) {
        toast.error('NPS score must be between -100 and 100.');
        return;
      }
      parsed = Math.round(numeric);
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ npsScore: parsed }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? 'Unable to update NPS score');
      }

      toast.success('NPS score updated');
      setSavedScore(parsed);
      setValue(parsed != null ? String(parsed) : '');
      setEditing(false);
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update NPS score');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div>
        <p className="text-xs uppercase text-foreground-subtle">NPS Score</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="font-medium text-foreground">
            {savedScore != null ? savedScore.toFixed(1) : '—'}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <label className="text-xs uppercase text-foreground-subtle">NPS Score</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={-100}
          max={100}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="NPS Score"
          className="w-24 rounded-md border border-border bg-surface-raised px-2 py-1 text-sm text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          placeholder="Enter score"
          disabled={saving}
          autoFocus
        />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex shrink-0 items-center justify-center rounded-md bg-primary px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setValue(savedScore != null ? String(savedScore) : '');
            setEditing(false);
          }}
          className="text-xs font-medium text-foreground-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
