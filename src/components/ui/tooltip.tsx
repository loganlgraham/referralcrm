'use client';

import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  children: ReactNode;
  /** If false, only renders the trigger (useful to opt-out conditionally). */
  enabled?: boolean;
}

const sideStyles: Record<NonNullable<TooltipProps['side']>, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5'
};

/**
 * Lightweight CSS-only tooltip. Uses :hover/:focus-within on the wrapper to show
 * a positioned bubble — keeps bundle size tiny and avoids a Radix Tooltip dep.
 */
export function Tooltip({ content, side = 'top', className, children, enabled = true }: TooltipProps) {
  if (!enabled) return <>{children}</>;
  return (
    <span className="relative inline-flex items-center group focus-within:z-30">
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-20 max-w-xs whitespace-pre-line rounded-md bg-[hsl(var(--text))] px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-raised transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100',
          sideStyles[side],
          className
        )}
      >
        {content}
      </span>
    </span>
  );
}
