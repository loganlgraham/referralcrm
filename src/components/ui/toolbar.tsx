import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Toolbar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Toolbar({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface-raised px-3 py-2 shadow-card',
          className
        )}
        {...props}
      />
    );
  }
);

export const ToolbarGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function ToolbarGroup({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex items-center gap-2', className)} {...props} />;
  }
);

export const ToolbarSpacer = () => <div className="flex-1" aria-hidden />;
