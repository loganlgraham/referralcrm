import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
  className?: string;
  /**
   * Replaces the default mono eyebrow styling. Lets a page opt out of the mono
   * treatment without restyling every other header.
   */
  eyebrowClassName?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  breadcrumbs,
  className,
  eyebrowClassName
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 space-y-1.5">
        {breadcrumbs && <div className="text-xs text-foreground-subtle">{breadcrumbs}</div>}
        {eyebrow && (
          <div className={eyebrowClassName ?? 'text-eyebrow text-foreground-muted'}>{eyebrow}</div>
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
