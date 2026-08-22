'use client';

import { cn } from '@/lib/cn';
import { pillSegmentClasses, pillTrackClasses } from '@/components/ui/pill-tabs';

export interface SegmentedPillOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedPillsProps<T extends string> {
  options: SegmentedPillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * Single-choice filter styled to match `PillTabs`. Tabs switch panels, so they
 * keep `tablist` semantics; this only narrows the data already on screen and
 * reads as a group of toggle buttons.
 */
export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedPillsProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn(pillTrackClasses, className)}>
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={pillSegmentClasses(isActive)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
