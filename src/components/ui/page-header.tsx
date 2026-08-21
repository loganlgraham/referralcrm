import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  /**
   * Whether this page has work waiting on someone. Omit it to keep the node
   * decorative; pass a real boolean and the node reads as a status light.
   */
  attention?: boolean;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
  attention,
  className
}: PageHeaderProps) {
  const nodeTone = attention === false ? 'bg-primary' : 'bg-signal';

  return (
    <header className={cn('relative flex flex-col gap-4 border-b border-border pb-5 pl-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <span aria-hidden className="absolute bottom-5 left-0 top-0 w-[3px] rounded-full bg-primary" />
      <span
        aria-hidden
        className={cn(
          'absolute bottom-3 left-[-3px] h-2.5 w-2.5 rounded-full border-2 border-surface-muted',
          nodeTone
        )}
      />
      <div className="min-w-0 space-y-1.5">
        {breadcrumbs && <div className="text-xs text-foreground-subtle">{breadcrumbs}</div>}
        {eyebrow && (
          <div className="text-eyebrow text-foreground-muted">{eyebrow}</div>
        )}
        <h1 className="truncate font-display text-2xl font-extrabold tracking-[-0.035em] text-foreground sm:text-[1.85rem]">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-sm text-foreground-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
