import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Field-level label. Sentence case Manrope, one step below `CardTitle`, so a card
 * can label its inner fields without reaching for a second typeface.
 */
export const SectionLabel = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function SectionLabel({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        className={cn('text-xs font-medium text-foreground-subtle', className)}
        {...props}
      />
    );
  }
);

export const sectionLabelClasses = 'text-xs font-medium text-foreground-subtle';
