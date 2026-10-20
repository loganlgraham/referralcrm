'use client';

import { type ChangeEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Input } from '@/components/ui/input';
import { FieldFootnote, FieldLabel } from '@/components/ui/field-group';

export {
  FieldGroup,
  FieldGrid,
  FieldLabel,
  FieldFootnote,
  SelectField,
  CheckboxField,
  SegmentedToggle,
} from '@/components/ui/field-group';
export type { SelectFieldOption, SegmentedToggleOption } from '@/components/ui/field-group';

export interface NumberFieldProps {
  label: string;
  /** Small qualifier beside the label, for meaning the unit adornment can't carry. */
  hint?: string;
  /** Unit rendered inside the field, e.g. `$`. */
  prefix?: string;
  /** Unit rendered inside the field, e.g. `%` or `yrs`. */
  suffix?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  footnote?: ReactNode;
  decimal?: boolean;
  disabled?: boolean;
  reserveFootnote?: boolean;
}

export function NumberField({
  label,
  hint,
  prefix,
  suffix,
  value,
  onChange,
  onBlur,
  footnote,
  decimal,
  disabled,
  reserveFootnote = true,
}: NumberFieldProps) {
  return (
    <label className={cn('block space-y-1.5', disabled && 'opacity-50')}>
      <FieldLabel label={label} hint={hint} />
      <div className="relative">
        {prefix ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-numeric text-sm text-foreground-subtle"
          >
            {prefix}
          </span>
        ) : null}
        <Input
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled}
          className={cn(
            'text-numeric font-medium',
            prefix && 'pl-7',
            suffix && 'pr-10'
          )}
        />
        {suffix ? (
          <span
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-foreground-subtle"
          >
            {suffix}
          </span>
        ) : null}
      </div>
      <FieldFootnote reserve={reserveFootnote}>{footnote}</FieldFootnote>
    </label>
  );
}
