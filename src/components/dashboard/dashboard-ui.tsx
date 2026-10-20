'use client';

import { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonClasses } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';

/** Single card shell shared by every dashboard widget. */
export const dashCardClasses = 'rounded-card border border-border bg-surface-raised p-4 shadow-card';

export function DashCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn(dashCardClasses, className)}>{children}</div>;
}

/** Small info icon that reveals methodology/details on hover or focus. */
export function DashInfoTip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip content={content} side="bottom" className="w-80 max-w-[calc(100vw-3rem)] text-left leading-relaxed">
      <button
        type="button"
        aria-label={label}
        className={buttonClasses({
          variant: 'ghost',
          size: 'icon',
          className: 'h-6 w-6 text-foreground-subtle hover:bg-transparent hover:text-foreground'
        })}
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/** Uppercase eyebrow title row with optional info tooltip and right-aligned actions. */
export function DashCardHeader({
  title,
  info,
  actions,
  className
}: {
  title: string;
  info?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-1.5">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-foreground-subtle">{title}</p>
        {info ? <DashInfoTip label={`${title} details`} content={info} /> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Unified empty state for dashboard widgets. */
export function DashCardEmpty({
  message = 'No data for this period.',
  className
}: {
  message?: string;
  className?: string;
}) {
  return <p className={cn('py-6 text-center text-sm text-foreground-subtle', className)}>{message}</p>;
}
