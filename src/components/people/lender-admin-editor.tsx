'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface LenderAdminEditorProps {
  lender: {
    _id: string;
    name: string;
    email: string;
    phone?: string;
    nmlsId?: string;
    licensedStates?: string[];
    npsScore?: number | null;
    active?: boolean;
    includeInMetrics?: boolean;
  };
  className?: string;
  onSaved?: () => void;
}

type FormState = {
  name: string;
  email: string;
  phone: string;
  nmlsId: string;
  licensedStates: string;
};

const buildInitialFormState = (lender: LenderAdminEditorProps['lender']): FormState => ({
  name: lender.name ?? '',
  email: lender.email ?? '',
  phone: lender.phone ?? '',
  nmlsId: lender.nmlsId ?? '',
  licensedStates: Array.isArray(lender.licensedStates) ? lender.licensedStates.join(', ') : '',
});

export function LenderAdminEditor({ lender, className, onSaved }: LenderAdminEditorProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => buildInitialFormState(lender));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(buildInitialFormState(lender));
  }, [lender]);

  const handleChange = (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);

    try {
      const licensedStates = form.licensedStates
        .split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);

      const response = await fetch(`/api/lenders/${lender._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          nmlsId: form.nmlsId,
          licensedStates,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.message ?? 'Unable to update mortgage consultant');
      }

      toast.success('Mortgage consultant updated');
      onSaved?.();
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs font-semibold text-foreground-muted">
          Name
          <input
            type="text"
            value={form.name}
            onChange={handleChange('name')}
            className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
            required
            disabled={saving}
          />
        </label>
        <label className="text-xs font-semibold text-foreground-muted">
          Email
          <input
            type="email"
            value={form.email}
            onChange={handleChange('email')}
            className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
            required
            disabled={saving}
          />
        </label>
        <label className="text-xs font-semibold text-foreground-muted">
          Phone
          <input
            type="tel"
            value={form.phone}
            onChange={handleChange('phone')}
            className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
            disabled={saving}
          />
        </label>
        <label className="text-xs font-semibold text-foreground-muted">
          NMLS ID
          <input
            type="text"
            value={form.nmlsId}
            onChange={handleChange('nmlsId')}
            className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
            disabled={saving}
          />
        </label>
        <label className="text-xs font-semibold text-foreground-muted md:col-span-2">
          Licensed states (comma separated)
          <input
            type="text"
            value={form.licensedStates}
            onChange={handleChange('licensedStates')}
            className="mt-1 w-full rounded border border-border px-3 py-2 text-sm"
            placeholder="CO, UT"
            disabled={saving}
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

export type { LenderAdminEditorProps };
