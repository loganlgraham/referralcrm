'use client';

import { ChangeEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { inputFieldClasses } from '@/components/ui/input';
import { formatCurrencyInputDisplay, sanitizeCurrencyInput } from '@/components/referrals/referral-detail-draft';

export type PreApprovalSavedDetails = { preApprovalAmountCents: number; referralFeeDueCents: number };

const centsToCurrencyInput = (value?: number | null) => {
  if (!value) {
    return '';
  }
  const amount = value / 100;
  return Number.isInteger(amount) ? amount.toString() : amount.toFixed(2);
};

/**
 * Inline pre-approval editor. `field` renders a bordered input-style box; `fact` matches the
 * rail fact grid (label over value) so it can sit inside Intake details.
 */
export function PreApprovalField({
  referralId,
  amountCents,
  onSaved,
  variant = 'field',
  disabled = false
}: {
  referralId: string;
  amountCents?: number | null;
  onSaved?: (details: PreApprovalSavedDetails) => void;
  variant?: 'field' | 'fact';
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(() => centsToCurrencyInput(amountCents));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setValue(centsToCurrencyInput(amountCents));
    setDirty(false);
  }, [amountCents]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setValue(sanitizeCurrencyInput(event.target.value));
    setDirty(true);
  };

  const handleCancel = () => {
    setValue(centsToCurrencyInput(amountCents));
    setDirty(false);
    setEditing(false);
  };

  const handleSave = async () => {
    const amount = Number.parseFloat(value);
    if (Number.isNaN(amount) || amount < 0) {
      toast.error('Enter a valid pre-approval amount.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/referrals/${referralId}/pre-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      if (!response.ok) {
        throw new Error('Unable to save pre-approval amount');
      }
      const body = (await response.json()) as PreApprovalSavedDetails;
      toast.success('Pre-approval updated');
      setDirty(false);
      setEditing(false);
      onSaved?.({
        preApprovalAmountCents: body.preApprovalAmountCents,
        referralFeeDueCents: body.referralFeeDueCents
      });
      router.refresh();
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : 'Unable to update pre-approval');
    } finally {
      setSaving(false);
    }
  };

  const display = value ? `$${formatCurrencyInputDisplay(value)}` : null;

  const editor = (
    <div className="space-y-2">
      <input
        type="text"
        inputMode="decimal"
        value={formatCurrencyInputDisplay(value)}
        onChange={handleChange}
        className={cn(inputFieldClasses, 'tabular-nums', variant === 'fact' ? 'h-9 text-sm' : null)}
        placeholder="300,000"
        aria-label="Pre-approval amount"
        autoFocus
        disabled={saving || disabled}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size={variant === 'fact' ? 'sm' : undefined}
          onClick={handleSave}
          disabled={!dirty}
          loading={saving}
          className="flex-1"
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size={variant === 'fact' ? 'sm' : undefined}
          variant="secondary"
          onClick={handleCancel}
          disabled={saving || disabled}
        >
          Cancel
        </Button>
      </div>
    </div>
  );

  const editButton = (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-md p-1 text-foreground-subtle transition hover:bg-surface-muted hover:text-foreground-muted disabled:cursor-not-allowed disabled:opacity-50"
      aria-label="Edit pre-approval"
    >
      <Pencil className={variant === 'fact' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />
    </button>
  );

  if (variant === 'fact') {
    return (
      <div className={cn('min-w-0', editing ? 'col-span-2' : null)}>
        <dt className="text-xs text-foreground-subtle">Pre-approval</dt>
        <dd className="mt-[3px]">
          {editing ? (
            editor
          ) : (
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  'text-sm font-semibold',
                  display ? 'text-numeric text-foreground' : 'text-foreground-subtle'
                )}
              >
                {display ?? 'Not set'}
              </span>
              {editButton}
            </span>
          )}
        </dd>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-foreground-subtle">Pre-approval</div>
      {editing ? (
        editor
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)]">
          <span className="tabular-nums">{display ?? 'No pre-approval'}</span>
          {editButton}
        </div>
      )}
    </div>
  );
}
