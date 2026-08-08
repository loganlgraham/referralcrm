import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const baseField =
  'flex w-full rounded-lg border border-border-strong/70 bg-surface px-3 py-2 text-sm text-foreground shadow-[inset_0_1px_1px_rgba(15,23,42,0.03)] transition placeholder:text-foreground-subtle focus:border-ring focus:outline-none focus:shadow-focus disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        baseField,
        'h-9',
        invalid && 'border-danger focus:border-danger focus:shadow-[0_0_0_4px_hsl(var(--danger)/0.22)]',
        className
      )}
      {...props}
    />
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, rows = 4, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        baseField,
        'min-h-[80px] py-2',
        invalid && 'border-danger focus:border-danger focus:shadow-[0_0_0_4px_hsl(var(--danger)/0.22)]',
        className
      )}
      {...props}
    />
  );
});
