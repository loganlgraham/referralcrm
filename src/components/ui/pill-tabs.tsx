'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export interface PillTabDefinition<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface PillTabsProps<T extends string> {
  tabs: PillTabDefinition<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  ariaLabel: string;
  idPrefix?: string;
  className?: string;
}

/**
 * The pill track and its segments are shared with `SegmentedPills` so filter
 * controls sitting next to the tabs can't drift out of step visually.
 */
export const pillTrackClasses =
  'scrollbar-thin inline-flex max-w-full gap-1 overflow-x-auto rounded-pill border border-border bg-surface-raised p-1 shadow-card';

export function pillSegmentClasses(isActive: boolean): string {
  return cn(
    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised',
    isActive
      ? 'bg-primary text-white shadow-sm'
      : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground'
  );
}

/**
 * Rail-mounted pill tabs with roving tabindex. Panels are rendered by the
 * caller, so a panel can stay mounted while another tab is shown.
 */
export function PillTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel,
  idPrefix = 'pill-tab',
  className,
}: PillTabsProps<T>) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const lastIndex = tabs.length - 1;
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = index === lastIndex ? 0 : index + 1;
    if (event.key === 'ArrowLeft') nextIndex = index === 0 ? lastIndex : index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = lastIndex;
    if (nextIndex === null) return;

    event.preventDefault();
    onTabChange(tabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(pillTrackClasses, className)}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={pillSegmentClasses(isActive)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 ? (
              <span
                className={cn(
                  'text-numeric rounded-pill px-1.5 text-[11px] font-semibold leading-4',
                  isActive ? 'bg-white/20 text-white' : 'bg-surface-muted text-foreground-muted'
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
