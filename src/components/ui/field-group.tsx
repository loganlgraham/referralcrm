import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** A titled block of related inputs. The mono eyebrow echoes the dashboard cards. */
export function FieldGroup({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-card border border-border bg-surface-raised p-4 shadow-card', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-eyebrow text-foreground-subtle">{title}</h3>
        {action}
      </div>
      {description ? (
        <p className="mt-1.5 text-xs text-foreground-muted">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Two-column field grid that collapses on narrow screens. */
export function FieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-x-4 gap-y-3 sm:grid-cols-2', className)}>{children}</div>;
}

export function FieldLabel({ label, hint }: { label: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {hint ? <span className="text-xs text-foreground-subtle">{hint}</span> : null}
    </div>
  );
}

/**
 * Footnotes are always rendered so neighbouring cells in a grid keep the same
 * height — otherwise a row with one helper line pushes the next row out of step.
 */
export function FieldFootnote({ children, reserve }: { children?: ReactNode; reserve: boolean }) {
  if (!children && !reserve) return null;
  return (
    <p className="min-h-[1rem] text-xs leading-4 text-foreground-subtle">{children ?? '\u00A0'}</p>
  );
}

export const selectFieldClasses =
  'h-9 w-full rounded-lg border border-border-strong/70 bg-surface px-3 text-sm text-foreground shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)] transition focus:border-ring focus:shadow-focus focus:outline-none disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60';

export interface SelectFieldOption {
  value: string;
  label: string;
}

export function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
  footnote,
  disabled,
  reserveFootnote = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  footnote?: ReactNode;
  disabled?: boolean;
  reserveFootnote?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <FieldLabel label={label} hint={hint} />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={selectFieldClasses}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldFootnote reserve={reserveFootnote}>{footnote}</FieldFootnote>
    </label>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border-strong text-primary focus:ring-ring"
      />
      {label}
    </label>
  );
}

export interface SegmentedToggleOption<T extends string> {
  value: T;
  label: string;
}

/** Compact two-or-three-way switch. Matches the admin task board control. */
export function SegmentedToggle<T extends string>({
  ariaLabel,
  value,
  onChange,
  options,
  className,
}: {
  ariaLabel: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentedToggleOption<T>[];
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-0.5 rounded-lg bg-surface-muted p-0.5', className)}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-surface-raised text-foreground shadow-sm ring-1 ring-border'
                : 'text-foreground-muted hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
