import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}

/**
 * The small metric tile used inside cards — quieter than `StatCard`, which owns
 * its own card shell. Values are mono so stacked tiles line up on the decimal.
 */
export function StatTile({ label, value, hint, className }: StatTileProps) {
  return (
    <div className={cn('rounded-lg bg-surface-muted px-3 py-2', className)}>
      <p className="text-xs text-foreground-subtle">{label}</p>
      <p className="text-numeric mt-0.5 text-base font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-foreground-subtle">{hint}</p> : null}
    </div>
  );
}
