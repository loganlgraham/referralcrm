import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  delta?: {
    value: string;
    direction?: 'up' | 'down' | 'neutral';
  };
  icon?: ReactNode;
  footer?: ReactNode;
  className?: string;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
}

const toneStyles: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'border-border bg-surface-raised',
  primary: 'border-primary-200 bg-primary-50/60',
  success: 'border-[hsl(var(--success)/0.25)] bg-success-soft/60',
  warning: 'border-[hsl(var(--warning)/0.25)] bg-warning-soft/60',
  danger: 'border-[hsl(var(--danger)/0.25)] bg-danger-soft/60'
};

const deltaTone = (direction: StatCardProps['delta'] extends infer T ? T : never) => {
  const dir = (direction as { direction?: string } | undefined)?.direction ?? 'neutral';
  if (dir === 'up') return 'bg-success-soft text-[hsl(var(--success))]';
  if (dir === 'down') return 'bg-danger-soft text-[hsl(var(--danger))]';
  return 'bg-surface-muted text-foreground-muted';
};

export function StatCard({
  label,
  value,
  hint,
  delta,
  icon,
  footer,
  className,
  tone = 'default'
}: StatCardProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-card border px-4 py-4 shadow-card transition',
        toneStyles[tone],
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</p>
        {icon && <div className="shrink-0 text-foreground-subtle">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold leading-none tracking-tight text-foreground">{value}</div>
        {delta && (
          <span className={cn('rounded-pill px-1.5 py-0.5 text-[11px] font-medium', deltaTone(delta))}>
            {delta.value}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-foreground-muted">{hint}</p>}
      {footer && <div className="pt-1">{footer}</div>}
    </div>
  );
}
