import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-display text-sm font-medium tracking-[-0.01em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0';

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white shadow-[0_1px_2px_rgba(15,23,42,0.16),0_6px_16px_-8px_rgba(15,23,42,0.55)] hover:bg-primary-hover hover:text-white active:bg-primary-active focus-visible:text-white',
  secondary:
    'bg-surface text-foreground ring-1 ring-inset ring-border shadow-sm hover:bg-surface-muted',
  outline:
    'bg-transparent text-foreground ring-1 ring-inset ring-border hover:bg-surface-muted',
  ghost: 'bg-transparent text-foreground hover:bg-surface-muted',
  subtle: 'bg-surface-muted text-foreground hover:bg-surface-subtle',
  danger: 'bg-danger text-white shadow-sm hover:bg-danger/90 hover:text-white focus-visible:text-white focus-visible:ring-danger'
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
  icon: 'h-9 w-9 p-0'
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    disabled,
    children,
    type,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cn(base, variantStyles[variant], sizeStyles[size], className)}
      {...props}
    >
      {loading ? (
        <span className="animate-spin" aria-hidden>
          <Loader2 className="h-4 w-4" />
        </span>
      ) : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
});
