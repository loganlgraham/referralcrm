'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export type CalculatorTabId = 'calculator' | 'amortization' | 'scenarios' | 'affordability';

export interface CalculatorTabDefinition {
  id: CalculatorTabId;
  label: string;
  count?: number;
}

interface CalculatorTabsProps {
  tabs: CalculatorTabDefinition[];
  activeTab: CalculatorTabId;
  onTabChange: (tab: CalculatorTabId) => void;
}

/**
 * Hand-rolled rather than the Radix `Tabs` primitive because the Affordability
 * panel has to stay mounted while other tabs are shown, so the panels are
 * rendered by the parent instead of by the tablist.
 */
export function CalculatorTabs({ tabs, activeTab, onTabChange }: CalculatorTabsProps) {
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
      aria-label="Calculator views"
      className="scrollbar-thin inline-flex max-w-full gap-1 overflow-x-auto rounded-pill border border-border bg-surface-raised p-1 shadow-card"
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
            id={`calculator-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`calculator-panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-pill px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised',
              isActive
                ? 'bg-primary text-white shadow-sm'
                : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground'
            )}
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
