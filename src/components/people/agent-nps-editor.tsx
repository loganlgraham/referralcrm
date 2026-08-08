'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface AgentNpsEditorProps {
  agentId: string;
  initialScore: number | null;
}

export function AgentNpsEditor({ agentId, initialScore }: AgentNpsEditorProps) {
  const [value, setValue] = useState(initialScore != null ? String(initialScore) : '');
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
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
      setValue(parsed != null ? String(parsed) : '');
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update NPS score');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-surface-muted p-4">
      <label className="block text-sm font-semibold text-foreground-muted">NPS score</label>
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="number"
          inputMode="numeric"
          min={-100}
          max={100}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40 sm:max-w-xs"
          placeholder="68"
          disabled={saving}
        />
        <button
          type="submit"
          disabled={saving}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save NPS'}
        </button>
      </div>
      <p className="mt-2 text-xs text-foreground-subtle">Only admins can update this score. Leave blank to clear the value.</p>
    </form>
  );
}
