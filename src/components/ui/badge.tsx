import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'progress'
  | 'accent'
  | 'outline';
export type BadgeSize = 'sm' | 'md';

const variantStyles: Record<BadgeVariant, string> = {
  neutral: 'bg-surface-muted text-foreground ring-1 ring-inset ring-border',
  success: 'bg-success-soft text-[hsl(var(--success))] ring-1 ring-inset ring-[hsl(var(--success)/0.25)]',
  warning: 'bg-warning-soft text-[hsl(var(--warning))] ring-1 ring-inset ring-[hsl(var(--warning)/0.3)]',
  danger: 'bg-danger-soft text-[hsl(var(--danger))] ring-1 ring-inset ring-[hsl(var(--danger)/0.3)]',
  info: 'bg-info-soft text-[hsl(var(--info))] ring-1 ring-inset ring-[hsl(var(--info)/0.25)]',
  // Signal orange — money or work in transit (payment sent). Reads as motion
  // rather than completion, and ties back to the route motif.
  progress: 'bg-signal-soft text-signal-dark ring-1 ring-inset ring-signal/30',
  accent: 'bg-accent-soft text-accent ring-1 ring-inset ring-accent/25',
  outline: 'bg-transparent text-foreground-muted ring-1 ring-inset ring-border'
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-px text-[10px] leading-4',
  md: 'px-2 py-0.5 text-[11px] leading-4'
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = 'neutral', size = 'md', dot = false, children, ...props },
  ref
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-pill font-medium',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
});
