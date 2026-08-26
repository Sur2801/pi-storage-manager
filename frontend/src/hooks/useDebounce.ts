import { useEffect, useState } from "react";

/**
 * Debounces a value — returns the latest value only after `delayMs` of
 * inactivity. Useful for search inputs to avoid firing a request on every
 * keystroke.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
