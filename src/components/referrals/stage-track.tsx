'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ReferralStatus } from '@/constants/referrals';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

const OUTCOME_STATUSES: readonly ReferralStatus[] = ['Lost', 'Terminated'];

export const isOutcomeStatus = (status: ReferralStatus) => OUTCOME_STATUSES.includes(status);

type StepState = 'done' | 'current' | 'upcoming' | 'inactive';

interface StageTrackProps<T extends string> {
  /** Every selectable status; outcome statuses are pulled out into the close-out menu. */
  options: readonly T[];
  currentStatus: T;
  getLabel: (status: T) => string;
  isOutcome: (status: T) => boolean;
  /** Replaces the close-out button text while the current status is an outcome. */
  outcomeLabel?: string | null;
  daysInStatus?: number | null;
  disabled?: boolean;
  /** Thinner bars and no per-step labels, for stacking a buy and sell track. */
  compact?: boolean;
  ariaLabel?: string;
  onSelect: (status: T) => void;
}

const formatDays = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`;

export function StageTrack<T extends string>({
  options,
  currentStatus,
  getLabel: label,
  isOutcome,
  outcomeLabel,
  daysInStatus,
  disabled = false,
  compact = false,
  ariaLabel = 'Stage',
  onSelect
}: StageTrackProps<T>) {
  const steps = options.filter((status) => !isOutcome(status));
  const outcomes = options.filter(isOutcome);
  const currentIsOutcome = isOutcome(currentStatus);
  const currentIndex = steps.indexOf(currentStatus);
  const showDays = typeof daysInStatus === 'number' && daysInStatus >= 0;
  const closeOutOptions = outcomes.filter((status) => status !== currentStatus);
  const currentLabel = currentIsOutcome && outcomeLabel ? outcomeLabel : label(currentStatus);

  const [previewStep, setPreviewStep] = useState<T | null>(null);
  const pointerTypeRef = useRef<string>('mouse');

  useEffect(() => {
    if (previewStep === null) return;
    const timer = window.setTimeout(() => setPreviewStep(null), 6000);
    return () => window.clearTimeout(timer);
  }, [previewStep]);

  const handleStepClick = (step: T, blocked: boolean) => {
    // Touch has no hover, so the first tap reveals the step name and a second tap commits.
    const isTouch = pointerTypeRef.current !== 'mouse';
    if (blocked || (isTouch && previewStep !== step)) {
      setPreviewStep(step);
      return;
    }
    setPreviewStep(null);
    onSelect(step);
  };

  const previewIsCurrent = previewStep !== null && previewStep === currentStatus;
  const previewHint =
    previewStep === null || previewIsCurrent || disabled
      ? null
      : pointerTypeRef.current === 'mouse'
        ? 'click to move here'
        : 'tap again to move here';

  const stateFor = (index: number): StepState => {
    if (currentIsOutcome || currentIndex === -1) return 'inactive';
    if (index < currentIndex) return 'done';
    if (index === currentIndex) return 'current';
    return 'upcoming';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <ol
          aria-label={ariaLabel}
          className="grid min-w-0 flex-1 gap-1"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((step, index) => {
            const state = stateFor(index);
            const isCurrent = state === 'current';
            const blocked = disabled || isCurrent;
            const isPreviewed = previewStep === step;
            return (
              <li key={step} className="min-w-0">
                <button
                  type="button"
                  onPointerDown={(event) => {
                    pointerTypeRef.current = event.pointerType;
                  }}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse') setPreviewStep(step);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse') {
                      setPreviewStep((current) => (current === step ? null : current));
                    }
                  }}
                  onClick={() => handleStepClick(step, blocked)}
                  aria-disabled={blocked || undefined}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={isCurrent ? `${label(step)} (current stage)` : `Move to ${label(step)}`}
                  title={label(step)}
                  className={cn(
                    'group flex w-full flex-col gap-2 rounded-md py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-1',
                    blocked ? 'cursor-default' : 'cursor-pointer'
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'block w-full rounded-pill transition-colors',
                      compact ? 'h-1' : 'h-1.5',
                      state === 'done' && 'bg-primary/70 group-hover:bg-primary',
                      state === 'current' && 'bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.14)]',
                      (state === 'upcoming' || state === 'inactive') &&
                        (blocked ? 'bg-border' : 'bg-border group-hover:bg-border-strong'),
                      isPreviewed && !isCurrent && 'ring-2 ring-primary/30 ring-offset-1 ring-offset-surface'
                    )}
                  />
                  {compact ? null : (
                    <span
                      className={cn(
                        'hidden text-xs leading-tight sm:block',
                        isCurrent
                          ? 'font-bold text-foreground'
                          : state === 'done'
                            ? 'font-medium text-foreground-muted group-hover:text-foreground'
                            : cn('font-medium text-foreground-subtle', !blocked && 'group-hover:text-foreground-muted')
                      )}
                    >
                      {label(step)}
                    </span>
                  )}
                </button>
                {isCurrent && showDays && !compact ? (
                  <p className="text-numeric hidden text-[11px] text-foreground-subtle sm:block">
                    {formatDays(daysInStatus)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        {outcomes.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={disabled || closeOutOptions.length === 0}
                className={cn(
                  'shrink-0',
                  currentIsOutcome &&
                    'bg-danger-soft text-danger shadow-[inset_0_0_0_1px_hsl(var(--danger)/0.3)] ring-0 hover:bg-danger-soft disabled:opacity-100'
                )}
                trailingIcon={
                  closeOutOptions.length > 0 ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : undefined
                }
              >
                {currentIsOutcome ? currentLabel : 'Close out'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {closeOutOptions.map((status) => (
                <DropdownMenuItem key={status} destructive onSelect={() => onSelect(status)}>
                  Mark as {label(status)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <p aria-live="polite" className={cn('min-h-[1.25rem] text-sm', compact ? null : 'sm:hidden')}>
        {previewStep !== null && !previewIsCurrent ? (
          <>
            <span className="font-bold text-foreground">{label(previewStep)}</span>
            {previewHint ? <span className="text-foreground-subtle"> · {previewHint}</span> : null}
            <span className="text-foreground-subtle"> · now {currentLabel}</span>
          </>
        ) : (
          <>
            <span className="text-foreground-subtle">Now </span>
            <span className="font-bold text-foreground">{currentLabel}</span>
            {showDays ? (
              <span className="text-numeric text-foreground-subtle"> · {formatDays(daysInStatus)}</span>
            ) : null}
          </>
        )}
      </p>
    </div>
  );
}
