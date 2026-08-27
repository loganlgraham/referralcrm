import { cn } from '@/lib/cn';
import { ReferrioIcon } from '@/components/brand/ReferrioIcon';
import { ReferrioWordmark } from '@/components/brand/ReferrioWordmark';

interface BrandMarkProps {
  className?: string;
  compact?: boolean;
  inverted?: boolean;
  /** `wordmark` drops the app icon and the product sub-label. */
  variant?: 'full' | 'wordmark';
  wordmarkSize?: number;
}

export function BrandMark({
  className,
  compact = false,
  inverted = false,
  variant = 'full',
  wordmarkSize
}: BrandMarkProps) {
  if (variant === 'wordmark') {
    return (
      <ReferrioWordmark
        className={className}
        size={wordmarkSize ?? 24}
        color={inverted ? '#FFFFFF' : '#0F1729'}
        accent="#E2694B"
        bg={inverted ? '#0F1729' : '#F1F5F9'}
      />
    );
  }

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
            size={wordmarkSize ?? 28}
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
