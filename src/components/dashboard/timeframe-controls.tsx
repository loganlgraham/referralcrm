'use client';

import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format as formatDate,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
  subWeeks,
  subYears
} from 'date-fns';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import { cn } from '@/lib/cn';

type SelectionPhase = 'start' | 'end';

export type TimeframePreset =
  | 'day'
  | 'week'
  | 'last_week'
  | 'next_week'
  | 'month'
  | 'last_month'
  | 'next_month'
  | 'year'
  | 'ytd'
  | 'all';
export type TimeframeKey = TimeframePreset | 'custom';
export type DateRange = { start: string; end: string };

type RangeDraft = { start: string | null; end: string | null };

type TimeframeDropdownProps = {
  timeframe: TimeframeKey;
  rangeLabel: string;
  customRange: DateRange;
  onPresetSelect: (preset: TimeframePreset) => void;
  onCustomRangeSelect: (range: DateRange) => void;
  maxDate: string;
  openToRightOnMobile?: boolean;
};

const DISPLAY_RANGE_FORMAT = 'MMM d, yyyy';
const WEEK_OPTIONS = { weekStartsOn: 1 as const };
const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export const TIMEFRAME_PRESETS: { label: string; value: TimeframePreset }[] = [
  { label: 'Today', value: 'day' },
  { label: 'This week', value: 'week' },
  { label: 'Last week', value: 'last_week' },
  { label: 'Next week', value: 'next_week' },
  { label: 'This month', value: 'month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'Next month', value: 'next_month' },
  { label: 'This year', value: 'year' },
  { label: 'Year to date', value: 'ytd' },
  { label: 'All time', value: 'all' }
];

const NEAR_TERM_PRESETS = TIMEFRAME_PRESETS.slice(0, 7);
const LONG_TERM_PRESETS = TIMEFRAME_PRESETS.slice(7);

function normalizeRange(start: string | null, end: string | null): RangeDraft {
  if (!start || !end) {
    return { start, end };
  }
  return start <= end ? { start, end } : { start: end, end: start };
}

export function formatDisplayRange(range: DateRange): string {
  if (!range.start || !range.end) {
    return 'Select timeframe';
  }
  const start = parseISO(range.start);
  const end = parseISO(range.end);
  const startLabel = formatDate(start, DISPLAY_RANGE_FORMAT);
  const endLabel = formatDate(end, DISPLAY_RANGE_FORMAT);
  if (range.start === range.end) {
    return startLabel;
  }
  return `${startLabel} – ${endLabel}`;
}

export function formatDateInput(date: Date): string {
  return formatDate(date, 'yyyy-MM-dd');
}

export function getPresetRange(preset: TimeframePreset): DateRange {
  const now = new Date();
  const end = formatDateInput(now);

  switch (preset) {
    case 'day': {
      const formatted = formatDateInput(startOfDay(now));
      return { start: formatted, end: formatted };
    }
    case 'week': {
      return {
        start: formatDateInput(startOfWeek(now, WEEK_OPTIONS)),
        end: formatDateInput(endOfWeek(now, WEEK_OPTIONS))
      };
    }
    case 'last_week': {
      const lastWeek = subWeeks(now, 1);
      return {
        start: formatDateInput(startOfWeek(lastWeek, WEEK_OPTIONS)),
        end: formatDateInput(endOfWeek(lastWeek, WEEK_OPTIONS))
      };
    }
    case 'next_week': {
      const nextWeek = addWeeks(now, 1);
      return {
        start: formatDateInput(startOfWeek(nextWeek, WEEK_OPTIONS)),
        end: formatDateInput(endOfWeek(nextWeek, WEEK_OPTIONS))
      };
    }
    case 'month': {
      return {
        start: formatDateInput(startOfMonth(now)),
        end: formatDateInput(endOfMonth(now))
      };
    }
    case 'last_month': {
      const lastMonth = subMonths(now, 1);
      return {
        start: formatDateInput(startOfMonth(lastMonth)),
        end: formatDateInput(endOfMonth(lastMonth))
      };
    }
    case 'next_month': {
      const nextMonth = addMonths(now, 1);
      return {
        start: formatDateInput(startOfMonth(nextMonth)),
        end: formatDateInput(endOfMonth(nextMonth))
      };
    }
    case 'year': {
      return { start: formatDateInput(startOfDay(subYears(now, 1))), end };
    }
    case 'ytd': {
      return { start: formatDateInput(startOfYear(now)), end };
    }
    case 'all': {
      return { start: formatDateInput(startOfDay(new Date(0))), end };
    }
    default: {
      const exhaustive: never = preset;
      return exhaustive;
    }
  }
}

export function isDateRangeValid(range: DateRange): boolean {
  return Boolean(range.start && range.end && range.start <= range.end);
}

function PresetList({
  options,
  timeframe,
  onSelect
}: {
  options: { label: string; value: TimeframePreset }[];
  timeframe: TimeframeKey;
  onSelect: (preset: TimeframePreset) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((option) => {
        const isActive = timeframe === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            className={cn(
              'rounded-pill px-2.5 py-1.5 text-left text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised',
              isActive
                ? 'bg-primary text-white'
                : 'text-foreground-muted hover:bg-surface-muted hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function TimeframeDropdown({
  timeframe,
  rangeLabel,
  customRange,
  onPresetSelect,
  onCustomRangeSelect,
  maxDate,
  openToRightOnMobile = false
}: TimeframeDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectionPhase, setSelectionPhase] = useState<SelectionPhase>('start');
  const [rangeDraft, setRangeDraft] = useState<RangeDraft>({ start: null, end: null });

  const closePicker = useCallback(() => {
    setIsOpen(false);
    setSelectionPhase('start');
    setRangeDraft({ start: null, end: null });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const defaultMonth = customRange.start ? parseISO(customRange.start) : new Date();
    setVisibleMonth(startOfMonth(defaultMonth));
    setSelectionPhase('start');
    setRangeDraft({ start: null, end: null });

    const handleClickOutside = (event: MouseEvent) => {
      if (!dropdownRef.current) {
        return;
      }
      if (!dropdownRef.current.contains(event.target as Node)) {
        closePicker();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePicker();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, customRange.start, closePicker]);

  const handlePresetClick = (preset: TimeframePreset) => {
    onPresetSelect(preset);
    closePicker();
  };

  const handleDayClick = (dateString: string) => {
    if (dateString > maxDate) {
      return;
    }

    if (selectionPhase === 'start') {
      setRangeDraft({ start: dateString, end: dateString });
      setSelectionPhase('end');
      return;
    }

    const startValue = rangeDraft.start ?? dateString;
    const sorted = normalizeRange(startValue, dateString);
    onCustomRangeSelect({ start: sorted.start ?? dateString, end: sorted.end ?? dateString });
    closePicker();
  };

  const handleDayHover = (dateString: string) => {
    if (selectionPhase === 'end' && rangeDraft.start && dateString <= maxDate) {
      setRangeDraft((prev) => ({ ...prev, end: dateString }));
    }
  };

  const displayedRange = useMemo(() => {
    if (selectionPhase === 'end' && rangeDraft.start) {
      const endValue = rangeDraft.end ?? rangeDraft.start;
      return normalizeRange(rangeDraft.start, endValue);
    }
    return normalizeRange(customRange.start, customRange.end);
  }, [selectionPhase, rangeDraft, customRange.start, customRange.end]);

  const calendarStart = useMemo(() => {
    return startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 });
  }, [visibleMonth]);

  const calendarEnd = useMemo(() => {
    return endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 0 });
  }, [visibleMonth]);

  const days = useMemo(() => {
    const result: Date[] = [];
    for (let day = calendarStart; day <= calendarEnd; day = addDays(day, 1)) {
      result.push(day);
    }
    return result;
  }, [calendarStart, calendarEnd]);

  const todayKey = formatDateInput(new Date());
  const selectionPrompt =
    selectionPhase === 'end'
      ? rangeDraft.start
        ? `Choose an end date (from ${formatDate(parseISO(rangeDraft.start), DISPLAY_RANGE_FORMAT)})`
        : 'Choose an end date'
      : null;

  const latestVisibleDate =
    displayedRange.end && displayedRange.end > maxDate ? displayedRange.end : maxDate;
  const canGoNextMonth = formatDateInput(startOfMonth(addMonths(visibleMonth, 1))) <= latestVisibleDate;

  return (
    <div ref={dropdownRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`Timeframe: ${rangeLabel}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="inline-flex h-9 items-center gap-2 rounded-pill border border-border bg-surface-raised px-3.5 text-sm font-medium text-foreground shadow-card transition hover:border-border-strong hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
      >
        <CalendarDays aria-hidden className="h-4 w-4 text-foreground-subtle" />
        <span>{rangeLabel}</span>
        <ChevronDown
          aria-hidden
          className={cn('h-4 w-4 text-foreground-subtle transition', isOpen && 'rotate-180')}
        />
      </button>
      {isOpen ? (
        <div
          className={cn(
            'absolute top-full z-20 mt-2 w-[22rem] rounded-card border border-border bg-surface-raised p-3 shadow-raised sm:w-[28rem]',
            openToRightOnMobile ? 'left-0 sm:left-auto sm:right-0' : 'right-0'
          )}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}
                  aria-label="Previous month"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ChevronLeft aria-hidden className="h-4 w-4" />
                </button>
                <div className="text-sm font-semibold text-foreground">
                  {formatDate(visibleMonth, 'MMMM yyyy')}
                </div>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
                  aria-label="Next month"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground-muted transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                  disabled={!canGoNextMonth}
                >
                  <ChevronRight aria-hidden className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-2 grid grid-cols-7 text-center text-[10px] font-medium uppercase tracking-[0.08em] text-foreground-subtle">
                {WEEKDAY_LABELS.map((day) => (
                  <div key={day} className="py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const dateKey = formatDateInput(day);
                  const isPastMax = dateKey > maxDate;
                  const inRange = Boolean(
                    displayedRange.start &&
                      displayedRange.end &&
                      dateKey >= displayedRange.start &&
                      dateKey <= displayedRange.end
                  );
                  const isStart = displayedRange.start === dateKey;
                  const isEnd = displayedRange.end === dateKey;
                  const isSingleDay = isStart && isEnd;
                  const rangeContinues = inRange && !isSingleDay;
                  const isCurrentMonth = day.getMonth() === visibleMonth.getMonth();
                  const isToday = dateKey === todayKey;
                  const isEndpoint = isStart || isEnd;

                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        'flex h-8 items-center justify-center',
                        rangeContinues && 'bg-primary-soft',
                        isStart && rangeContinues && 'rounded-l-full',
                        isEnd && rangeContinues && 'rounded-r-full'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleDayClick(dateKey)}
                        onMouseEnter={() => handleDayHover(dateKey)}
                        disabled={isPastMax}
                        className={cn(
                          'relative flex h-8 w-8 items-center justify-center rounded-full text-xs tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none',
                          isEndpoint
                            ? 'bg-primary font-medium text-white'
                            : isPastMax
                              ? 'text-foreground-subtle'
                              : isCurrentMonth
                                ? 'text-foreground-muted hover:bg-surface-muted'
                                : 'text-foreground-subtle hover:bg-surface-muted',
                          isToday &&
                            !isEndpoint &&
                            'font-semibold text-foreground after:absolute after:bottom-1 after:h-0.5 after:w-3 after:rounded-full after:bg-primary'
                        )}
                      >
                        {formatDate(day, 'd')}
                      </button>
                    </div>
                  );
                })}
              </div>

              {selectionPrompt ? (
                <p className="mt-2 text-xs text-foreground-subtle">{selectionPrompt}</p>
              ) : null}
            </div>

            <div className="sm:w-[8.75rem] sm:shrink-0 sm:border-l sm:border-border sm:pl-3">
              <PresetList
                options={NEAR_TERM_PRESETS}
                timeframe={timeframe}
                onSelect={handlePresetClick}
              />
              <div className="my-1.5 h-px bg-border" />
              <PresetList
                options={LONG_TERM_PRESETS}
                timeframe={timeframe}
                onSelect={handlePresetClick}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TimeframePresetButton({
  value,
  label,
  isActive,
  onClick
}: {
  value: TimeframePreset;
  label: string;
  isActive: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-value={value}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        isActive ? 'border-transparent bg-foreground text-white' : 'border-border bg-surface-raised text-foreground-muted hover:border-border-strong'
      }`}
    >
      {label}
    </button>
  );
}
