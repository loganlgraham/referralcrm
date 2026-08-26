import { cn } from '@/lib/cn';
import { ReferrioIcon } from '@/components/brand/ReferrioIcon';
import { ReferrioWordmark } from '@/components/brand/ReferrioWordmark';

interface BrandMarkProps {
  className?: string;
  compact?: boolean;
  inverted?: boolean;
}

export function BrandMark({ className, compact = false, inverted = false }: BrandMarkProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <ReferrioIcon
        className="shrink-0"
        size={32}
        variant={inverted ? 'light' : 'navy'}
      />
      {!compact ? (
        <span className="flex min-w-0 flex-col gap-1 leading-none">
          <ReferrioWordmark
            size={28}
            color={inverted ? '#FFFFFF' : '#0F1729'}
            accent="#E2694B"
            bg={inverted ? '#0F1729' : '#F1F5F9'}
          />
          <span
            className={cn(
              'truncate text-[11px] font-semibold uppercase tracking-[0.22em]',
              inverted ? 'text-white/70' : 'text-foreground-subtle'
            )}
          >
            Handoff Desk
          </span>
        </span>
      ) : null}
    </span>
  );
}
