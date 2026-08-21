'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FieldGrid, FieldLabel } from '@/components/ui/field-group';
import { Input } from '@/components/ui/input';

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
      <FieldGrid>
        <label className="block space-y-1.5">
          <FieldLabel label="Name" />
          <Input type="text" value={form.name} onChange={handleChange('name')} required disabled={saving} />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel label="Email" />
          <Input type="email" value={form.email} onChange={handleChange('email')} required disabled={saving} />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel label="Phone" />
          <Input
            type="tel"
            value={form.phone}
            onChange={handleChange('phone')}
            disabled={saving}
            className="text-numeric"
          />
        </label>
        <label className="block space-y-1.5">
          <FieldLabel label="NMLS ID" />
          <Input
            type="text"
            value={form.nmlsId}
            onChange={handleChange('nmlsId')}
            disabled={saving}
            className="text-numeric"
          />
        </label>
        <label className="block space-y-1.5 sm:col-span-2">
          <FieldLabel label="Licensed states" hint="comma separated" />
          <Input
            type="text"
            value={form.licensedStates}
            onChange={handleChange('licensedStates')}
            placeholder="CO, UT"
            disabled={saving}
          />
        </label>
      </FieldGrid>
      <div className="mt-4 flex justify-end">
        <Button type="submit" loading={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

export type { LenderAdminEditorProps };
