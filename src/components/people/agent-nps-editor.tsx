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
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex-1">
          <label className="text-sm font-semibold text-slate-700">
            NPS score
            <input
              type="number"
              inputMode="numeric"
              min={-100}
              max={100}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
              placeholder="68"
              disabled={saving}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500">Only admins can update this score. Leave blank to clear the value.</p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save NPS'}
        </button>
      </div>
    </form>
  );
}
