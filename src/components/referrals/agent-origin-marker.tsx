'use client';

import { Send } from 'lucide-react';

import { cn } from '@/lib/cn';

const LABEL = 'Referred by an agent for AFC';

interface AgentOriginMarkerProps {
  /** Compact icon chip for dense tables; labeled mark for detail headers. */
  size?: 'sm' | 'md';
  className?: string;
}

export function AgentOriginMarker({ size = 'sm', className }: AgentOriginMarkerProps) {
  const isCompact = size === 'sm';

  return (
    <span
      title={LABEL}
      aria-label={LABEL}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-pill bg-primary text-white',
        isCompact ? 'h-5 w-5 rounded-md' : 'h-7 pl-2 pr-2.5',
        className
      )}
    >
      <Send className={isCompact ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2.5} aria-hidden />
      {!isCompact ? (
        <span className="font-display text-xs font-medium tracking-[-0.01em]">Via agent</span>
      ) : null}
    </span>
  );
}
