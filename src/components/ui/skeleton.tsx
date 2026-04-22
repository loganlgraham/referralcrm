import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-muted', className)}
      aria-hidden
      {...props}
    />
  );
}

export function TableSkeleton({
  rows = 6,
  columns = 5,
  className
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-card border border-border bg-surface-raised', className)}>
      <div className="flex items-center gap-4 border-b border-border bg-surface-muted/60 px-4 py-3">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={`h-${index}`} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={`r-${rowIdx}`} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }).map((_, colIdx) => (
              <Skeleton key={`c-${rowIdx}-${colIdx}`} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-3 rounded-card border border-border bg-surface-raised p-5 shadow-card', className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  );
}
