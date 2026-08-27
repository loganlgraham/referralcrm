'use client';

import { useId, type ReactElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

export type PromptToastWidth = 'compact' | 'wide';

const widthClasses: Record<PromptToastWidth, string> = {
  compact: 'w-[min(calc(100vw-2rem),360px)]',
  wide: 'w-[min(calc(100vw-2rem),40rem)]'
};

/**
 * The one card every in-flow prompt renders inside, so a close-date confirm and a
 * full deal form read as the same surface. Tokens follow `toast-surface` in
 * docs/DESIGN.md: raised surface, card radius, and the deeper overlay shadow.
 */
export function PromptToastCard({
  title,
  description,
  width = 'compact',
  submitLabel,
  cancelLabel = 'Cancel',
  submitting = false,
  onCancel,
  onSubmit,
  children,
  bodyClassName
}: {
  title: string;
  description?: ReactNode;
  width?: PromptToastWidth;
  submitLabel: string;
  cancelLabel?: string;
  submitting?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <form
      className={cn(
        'max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card border border-border bg-surface-raised px-5 py-4 shadow-raised',
        widthClasses[width]
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h2 className="text-base font-semibold tracking-[-0.01em] text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1 text-xs leading-4 text-foreground-subtle">{description}</p>
      ) : null}
      <div className={cn('mt-3.5 space-y-3', bodyClassName)}>{children}</div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={submitting}>
          {cancelLabel}
        </Button>
        <Button type="submit" size="sm" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function PromptToastField({
  label,
  children,
  className
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/** Boxed question used for the AFC financing choice. */
export function PromptToastFieldset({
  legend,
  description,
  children,
  className
}: {
  legend: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();

  return (
    <fieldset
      aria-labelledby={headingId}
      className={cn('rounded-md border border-border bg-surface-muted px-3 py-2.5', className)}
    >
      <p id={headingId} className="text-sm font-medium text-foreground">
        {legend}
      </p>
      {description ? (
        <p className="mt-1 text-xs leading-4 text-foreground-subtle">{description}</p>
      ) : null}
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

export const promptToastRadioClasses = 'h-4 w-4 shrink-0 accent-primary';
export const promptToastCheckboxClasses =
  'mt-0.5 h-4 w-4 rounded border-border-strong text-primary focus:ring-ring';
export const promptToastCheckLabelClasses =
  'flex items-start gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs leading-4 text-foreground-muted';
export const promptToastRadioLabelClasses =
  'flex w-fit cursor-pointer items-center gap-2 text-sm text-foreground-muted';
export const promptToastHintClasses = 'text-xs leading-4 text-foreground-subtle';
export const promptToastWarningClasses =
  'rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-4 text-warning';

/**
 * Opens a prompt toast and resolves once — via the form, the cancel button, or a
 * dismissal — so callers can `await` the answer instead of threading callbacks.
 */
export function openPromptToast<T>(
  render: (finalize: (result: T) => void) => ReactElement,
  cancelledResult: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;

    const finalize = (result: T) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
      toast.dismiss(toastId);
    };

    const toastId = toast.custom(() => render(finalize), {
      duration: Infinity,
      position: 'top-center',
      closeButton: false,
      onDismiss: () => finalize(cancelledResult),
      onAutoClose: () => finalize(cancelledResult)
    });
  });
}
