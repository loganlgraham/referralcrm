'use client';

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format as formatDate,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subYears
} from 'date-fns';
import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

type SelectionPhase = 'start' | 'end';

export type TimeframePreset = 'day' | 'week' | 'month' | 'year' | 'ytd';
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
};

const DISPLAY_RANGE_FORMAT = 'MMM d, yyyy';

export const TIMEFRAME_PRESETS: { label: string; value: TimeframePreset }[] = [
  { label: 'Today', value: 'day' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
  { label: 'This year', value: 'year' },
  { label: 'Year to date', value: 'ytd' }
];

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
      const dayStart = startOfDay(now);
      const formatted = formatDateInput(dayStart);
      return { start: formatted, end: formatted };
    }
    case 'week': {
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      return { start: formatDateInput(weekStart), end };
    }
    case 'year': {
      const yearStart = startOfDay(subYears(now, 1));
      return { start: formatDateInput(yearStart), end };
    }
    case 'ytd': {
      const start = startOfYear(now);
      return { start: formatDateInput(start), end };
    }
    case 'month':
    default: {
      const start = startOfMonth(now);
      return { start: formatDateInput(start), end };
    }
  }
}

export function isDateRangeValid(range: DateRange): boolean {
  return Boolean(range.start && range.end && range.start <= range.end);
}

export function TimeframeDropdown({
  timeframe,
  rangeLabel,
  customRange,
  onPresetSelect,
  onCustomRangeSelect,
  maxDate
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

  const days: Date[] = [];
  for (let day = calendarStart; day <= calendarEnd; day = addDays(day, 1)) {
    days.push(day);
  }

  const maxDateLabel = formatDate(parseISO(maxDate), DISPLAY_RANGE_FORMAT);
  const selectionPrompt =
    selectionPhase === 'start'
      ? 'Choose a start date'
      : rangeDraft.start
      ? `Choose an end date (starting ${formatDate(parseISO(rangeDraft.start), DISPLAY_RANGE_FORMAT)})`
      : 'Choose an end date';

  const canGoNextMonth = formatDateInput(addMonths(visibleMonth, 1)) <= maxDate;

  return (
    <div ref={dropdownRef} className="relative flex flex-col items-end gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Timeframe</span>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
      >
        <span>{rangeLabel}</span>
        <span className="text-xs text-slate-400">▾</span>
      </button>
      {isOpen ? (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setVisibleMonth((prev) => addMonths(prev, -1))}
              className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              ‹
            </button>
            <div className="text-sm font-semibold text-slate-700">{formatDate(visibleMonth, 'MMMM yyyy')}</div>
            <button
              type="button"
              onClick={() => setVisibleMonth((prev) => addMonths(prev, 1))}
              className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-40"
              disabled={!canGoNextMonth}
            >
              ›
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((day) => {
              const dateKey = formatDateInput(day);
              const isPastMax = dateKey > maxDate;
              const isSelected =
                displayedRange.start && displayedRange.end && dateKey >= displayedRange.start && dateKey <= displayedRange.end;
              const isStart = displayedRange.start === dateKey;
              const isEnd = displayedRange.end === dateKey;
              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => handleDayClick(dateKey)}
                  onMouseEnter={() => handleDayHover(dateKey)}
                  className={`rounded px-0.5 py-1 text-xs transition ${
                    isSelected
                      ? 'bg-slate-900 text-white'
                      : isPastMax
                      ? 'text-slate-300'
                      : 'text-slate-700 hover:bg-slate-100'
                  } ${isStart ? 'rounded-l-full' : ''} ${isEnd ? 'rounded-r-full' : ''}`}
                  disabled={isPastMax}
                >
                  {formatDate(day, 'd')}
                </button>
              );
            })}
          </div>

          <div className="mt-3 text-xs text-slate-500">
            <p>{selectionPrompt}</p>
            <p className="mt-1">Latest selectable date: {maxDateLabel}</p>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Quick ranges</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TIMEFRAME_PRESETS.map((option) => {
                const isActive = timeframe === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handlePresetClick(option.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                      isActive
                        ? 'border-transparent bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
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
        isActive ? 'border-transparent bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
      }`}
    >
      {label}
    </button>
  );
}

