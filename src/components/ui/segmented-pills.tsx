'use client';

import { Check } from 'lucide-react';
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

interface MultiSegmentedPillsProps<T extends string> {
  options: SegmentedPillOption<T>[];
  values: readonly T[];
  onToggle: (value: T) => void;
  ariaLabel: string;
  /** Renders a leading "select everything" chip that is active when `values` is empty. */
  allLabel?: string;
  onSelectAll?: () => void;
  className?: string;
}

/**
 * Multi-choice variant of `SegmentedPills`: each chip toggles independently and
 * shows a check when on, so it reads as a set of filters rather than a radio.
 */
export function MultiSegmentedPills<T extends string>({
  options,
  values,
  onToggle,
  ariaLabel,
  allLabel,
  onSelectAll,
  className
}: MultiSegmentedPillsProps<T>) {
  const isAllActive = values.length === 0;
  return (
    <div role="group" aria-label={ariaLabel} className={cn(pillTrackClasses, className)}>
      {allLabel && onSelectAll ? (
        <button
          type="button"
          aria-pressed={isAllActive}
          onClick={onSelectAll}
          className={pillSegmentClasses(isAllActive)}
        >
          {allLabel}
        </button>
      ) : null}
      {options.map((option) => {
        const isActive = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onToggle(option.value)}
            className={cn(pillSegmentClasses(isActive), 'gap-1.5 pl-3')}
          >
            <Check
              aria-hidden
              className={cn(
                'h-3.5 w-3.5 transition-all duration-150',
                isActive ? 'scale-100 opacity-100' : 'scale-50 opacity-40'
              )}
              strokeWidth={isActive ? 2.75 : 2}
            />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
