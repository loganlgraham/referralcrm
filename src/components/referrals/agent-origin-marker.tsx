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
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-gradient-to-br from-primary-hover to-primary text-white shadow-sm ring-1 ring-inset ring-white/15',
        isCompact ? 'h-5 w-5' : 'h-6 pl-1.5 pr-2',
        className
      )}
    >
      <Send className={isCompact ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={2.5} aria-hidden />
      {!isCompact ? (
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">via agent</span>
      ) : null}
    </span>
  );
}
