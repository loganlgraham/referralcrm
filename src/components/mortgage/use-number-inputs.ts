'use client';

import { ChangeEvent, useCallback, useMemo, useRef, useState } from 'react';

export interface NumberInputHandlers<K extends string> {
  /** Change handler that parses the typed value and reports it as a number. */
  onChange: (key: K) => (event: ChangeEvent<HTMLInputElement>) => void;
  /** Drops the in-progress text so the formatted value takes over. */
  onBlur: (key: K) => () => void;
  /** Text to render: the raw keystrokes while focused, formatted otherwise. */
  format: (key: K, value: number) => string;
  reset: () => void;
}

/**
 * Keeps thousands separators on numeric text inputs without fighting the user
 * mid-keystroke: the raw string is held while a field is focused and dropped on
 * blur so trailing decimal points and commas survive typing.
 */
export function useNumberInputs<K extends string>(
  onValueChange: (key: K, value: number) => void
): NumberInputHandlers<K> {
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});

  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;

  const onChange = useCallback(
    (key: K) => (event: ChangeEvent<HTMLInputElement>) => {
      const rawValue = event.target.value;
      setRawInputs((prev) => ({ ...prev, [key]: rawValue }));

      const parsed = Number.parseFloat(rawValue.replace(/,/g, ''));
      onValueChangeRef.current(key, Number.isNaN(parsed) ? 0 : parsed);
    },
    []
  );

  const onBlur = useCallback(
    (key: K) => () => {
      setRawInputs((prev) => {
        if (prev[key] === undefined) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    []
  );

  const format = useCallback(
    (key: K, value: number): string => {
      const raw = rawInputs[key];
      if (raw !== undefined) return raw;
      if (value === 0) return '0';

      return value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      });
    },
    [rawInputs]
  );

  const reset = useCallback(() => setRawInputs({}), []);

  return useMemo(
    () => ({ onChange, onBlur, format, reset }),
    [onChange, onBlur, format, reset]
  );
}
