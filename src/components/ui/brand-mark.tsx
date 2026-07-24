import { cn } from '@/lib/cn';

interface BrandMarkProps {
  className?: string;
  compact?: boolean;
  inverted?: boolean;
}

export function BrandMark({ className, compact = false, inverted = false }: BrandMarkProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'relative flex shrink-0 items-center rounded-[10px] border p-1.5',
          compact ? 'h-8 w-8' : 'h-9 w-9',
          inverted
            ? 'border-white/20 bg-white/10'
            : 'border-primary-200 bg-primary-50'
        )}
      >
        <svg viewBox="0 0 28 28" fill="none" className="h-full w-full">
          <path
            d="M7 8.5h8.5a5.5 5.5 0 0 1 0 11H13"
            stroke={inverted ? 'white' : '#2457D6'}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="7" cy="8.5" r="3.25" fill={inverted ? 'white' : '#2457D6'} />
          <circle cx="11.5" cy="19.5" r="3.25" fill="#E4684A" />
        </svg>
      </span>
      {!compact ? (
        <span className="flex min-w-0 flex-col leading-none">
          <span className={cn('truncate font-display text-[15px] font-semibold tracking-[-0.025em]', inverted ? 'text-white' : 'text-foreground')}>
            Referrio
          </span>
          <span className={cn('route-label mt-1 truncate text-[9px] tracking-[0.1em]', inverted ? 'text-white/70' : 'text-foreground-subtle')}>
            Handoff desk
          </span>
        </span>
      ) : null}
    </span>
  );
}
