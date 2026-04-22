import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 items-center rounded border border-border bg-surface px-1.5 font-mono text-[10px] font-semibold text-foreground-muted shadow-sm',
        className
      )}
      {...props}
    />
  );
}
